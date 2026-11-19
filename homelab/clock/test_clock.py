import datetime
import json
import time
import tempfile
import os
import sqlite3
import unittest
from unittest.mock import MagicMock, patch
from clock import ClockApplication, ClockHistory, TokenBucket, satellite_counts, tracking_is_healthy, tracking_metrics


def tracking_report(now):
    date = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime('%a %b %d %H:%M:%S %Y')
    return (f'Reference ID : 50505300 (PPS)\nStratum : 1\nRef time (UTC) : {date}\n'
            'Leap status : Normal\nSystem time : 0.000001656 seconds fast of NTP time\n'
            'Last offset : +0.000001791 seconds\nRMS offset : 0.000002664 seconds\n'
            'Frequency : 9.923 ppm fast\nResidual freq : +0.022 ppm\nSkew : 0.138 ppm\n'
            'Root delay : 0.000000001 seconds\nRoot dispersion : 0.000014253 seconds\n'
            'Update interval : 16.0 seconds\n')


class ClockTests(unittest.TestCase):
    def test_history_storage_failure_does_not_stop_healthy_clock(self):
        app = ClockApplication()
        app.history = MagicMock()
        app.history.record.side_effect = sqlite3.OperationalError('database or disk is full')
        report = tracking_report(time.time())
        with patch('clock.subprocess.run', return_value=MagicMock(stdout=report)), \
                patch('clock.time.sleep', side_effect=RuntimeError('end monitor test')):
            with self.assertRaisesRegex(RuntimeError, 'end monitor test'):
                app.monitor()
        self.assertTrue(app.healthy)
        self.assertIsNone(app.stability)
        result = b''.join(app({'PATH_INFO': '/time', 'REQUEST_METHOD': 'GET'},
                             lambda status, headers: self.assertEqual(status, '200 OK')))
        self.assertTrue(json.loads(result)['synchronized'])

    def test_stability_persists_and_counts_missing_time_as_unobserved(self):
        with tempfile.TemporaryDirectory() as directory:
            history = ClockHistory(directory + '/history.sqlite')
            midnight = datetime.datetime(2026, 11, 18, tzinfo=datetime.timezone.utc).timestamp()
            history.record(True, midnight)
            history.record(True, midnight + 1)  # Same slot is never counted twice.
            history.record(False, midnight + 10)
            result = ClockHistory(history.path).record(True, midnight + 50)
            self.assertEqual(result, {'days': [{'date': '2026-11-18', 'observed': 3, 'locked': 2}], 'intervalSeconds': 10})
            # A same-slot failure replaces the successful check conservatively.
            result = history.record(False, midnight + 51)
            self.assertEqual(result['days'][0]['locked'], 1)
            # Backward time does not add observations to earlier slots.
            self.assertEqual(history.record(True, midnight + 20), result)
            result = history.record(False, midnight + 86400)
            self.assertEqual(result['days'][1], {'date': '2026-11-19', 'observed': 1, 'locked': 0})
            # The retention window is bounded to today and the trailing 90 days.
            result = history.record(True, midnight + 92 * 86400)
            self.assertEqual(len(result['days']), 1)

    def test_stability_retention_remains_bounded_as_days_accumulate(self):
        with tempfile.TemporaryDirectory() as directory:
            history = ClockHistory(directory + '/history.sqlite')
            start = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
            for day in range(180):
                result = history.record(day % 2 == 0, start + day * 86400)
                self.assertLessEqual(len(result['days']), 91)
            self.assertEqual(len(result['days']), 91)
            self.assertEqual(result['days'][0]['date'], '2026-03-31')
            self.assertLessEqual(os.path.getsize(history.path), 1048576)

    def test_tracking_metrics_preserve_units_signs_and_strip_strings(self):
        now = 1791379451
        report = tracking_report(now)
        metrics = tracking_metrics(report, now + 2)
        self.assertEqual(len(metrics), 10)
        self.assertEqual(metrics['systemOffsetSeconds'], 0.000001656)
        self.assertEqual(metrics['frequencyPpm'], 9.923)
        self.assertEqual(metrics['referenceAgeSeconds'], 2)
        self.assertEqual(metrics['lastOffsetSeconds'], 0.000001791)
        self.assertEqual(metrics['rootDispersionSeconds'], 0.000014253)
        self.assertEqual(metrics['updateIntervalSeconds'], 16)
        slow = tracking_metrics(report.replace('fast', 'slow'), now)
        self.assertEqual(slow['systemOffsetSeconds'], -metrics['systemOffsetSeconds'])
        self.assertEqual(slow['frequencyPpm'], -metrics['frequencyPpm'])
        invalid = report.replace('0.000002664', '-1').replace('9.923', 'NaN').replace('+0.022', '9999999')
        result = tracking_metrics(invalid, now)
        for key in ('rmsOffsetSeconds', 'frequencyPpm', 'residualFrequencyPpm'):
            self.assertNotIn(key, result)
        self.assertNotIn('Reference ID', metrics)

    def test_observed_pps_lock_resets_on_failed_or_missed_checks(self):
        now = 1791379451
        report = tracking_report(now)
        app = ClockApplication()
        with patch('clock.time.time', return_value=now), patch('clock.time.monotonic', return_value=100) as monotonic:
            app.update_tracking(report, 'PPS')
            self.assertEqual(app.locked_since, 100)
            monotonic.return_value = 110
            app.update_tracking(report, 'PPS')
            self.assertEqual(app.locked_since, 100)
            app.update_tracking('', 'PPS')
            self.assertFalse(app.healthy)
            self.assertEqual(app.tracking, {})
            self.assertIsNone(app.locked_since)
            monotonic.return_value = 120
            app.update_tracking(report, 'PPS')
            self.assertEqual(app.locked_since, 120)
            monotonic.return_value = 151
            app.update_tracking(report, 'PPS')
            self.assertEqual(app.locked_since, 151)

    def test_receiver_fields_expire_independently_and_never_publish_position(self):
        app = ClockApplication()
        with patch('clock.time.monotonic', return_value=100) as monotonic:
            app.limiter = TokenBucket()
            app.healthy = True
            app.checked_at = 100
            app.update_receiver({'class': 'TPV', 'mode': 3, 'lat': 1, 'lon': 2, 'alt': 3})
            app.update_receiver({'class': 'SKY', 'tdop': 1.12, 'satellites': [
                {'PRN': 5, 'used': True, 'ss': 31},
                {'PRN': 6, 'used': False, 'ss': 0},
                {'PRN': 5, 'used': False, 'ss': 35},
            ]})
            def request():
                return json.loads(b''.join(app(
                    {'PATH_INFO': '/time', 'REQUEST_METHOD': 'GET'},
                    lambda status, headers: self.assertEqual(status, '200 OK'))))
            first = request()
            self.assertEqual(first['receiver'], {'fixMode': 3, 'tdop': 1.12})
            self.assertEqual(first['satellites'], {'used': 1, 'visible': 2, 'tracked': 1})
            monotonic.return_value = 120
            app.checked_at = 120
            app.update_receiver({'class': 'SKY', 'tdop': 1.2})
            app.update_receiver({'class': 'TPV', 'mode': True})
            self.assertEqual(request()['satellites'], first['satellites'])
            monotonic.return_value = 131
            final = request()
            self.assertNotIn('satellites', final)
            self.assertEqual(final['receiver'], {'tdop': 1.2})
            monotonic.return_value = 151
            app.checked_at = 151
            self.assertNotIn('receiver', request())

    def test_partial_sky_reports_preserve_counts_without_refreshing_age(self):
        app = ClockApplication()
        connection = MagicMock()
        stream = connection.makefile.return_value.__enter__.return_value
        stream.readline.side_effect = [
            json.dumps({'class': 'SKY', 'satellites': [
                {'PRN': 5, 'used': True}, {'PRN': 6, 'used': False},
            ]}).encode() + b'\n',
            b'{"class":"SKY","hdop":1.06}\n',
            b'{"class":"SKY","hdop":1.06}\n',
            RuntimeError('end test stream'),
        ]
        with patch('clock.socket.create_connection') as connect, \
                patch('clock.time.monotonic', return_value=100) as monotonic:
            connect.return_value.__enter__.return_value = connection
            with self.assertRaisesRegex(RuntimeError, 'end test stream'):
                app.observe_satellites()
        self.assertEqual(app.satellites, {'used': 1, 'visible': 2})
        self.assertEqual(app.satellites_at, 100)
        monotonic.assert_called_once()

    def test_satellites_are_deduplicated_and_location_is_discarded(self):
        report = {'class': 'SKY', 'lat': 31, 'lon': 121, 'satellites': [
            {'gnssid': 0, 'svid': 1, 'sigid': 1, 'used': False, 'az': 100, 'el': 40},
            {'gnssid': 0, 'svid': 1, 'sigid': 2, 'used': True},
            {'gnssid': 2, 'svid': 1, 'used': False},
        ]}
        self.assertEqual(satellite_counts(report), {'used': 1, 'visible': 2})
        self.assertEqual(satellite_counts({'class': 'SKY', 'satellites': [
            {'PRN': 1, 'used': True}, {'PRN': 1, 'used': False},
        ]}), {'used': 1, 'visible': 1})
        for report in ({'class': 'SKY'}, {'class': 'TPV', 'satellites': []},
                       {'class': 'SKY', 'satellites': [{'PRN': 1}]},
                       {'class': 'SKY', 'satellites': [{'used': True}]}):
            self.assertIsNone(satellite_counts(report))
        self.assertEqual(satellite_counts({'class': 'SKY', 'satellites': []}),
                         {'used': 0, 'visible': 0})

    def test_missing_or_stale_satellites_do_not_break_clock(self):
        app = ClockApplication()
        app.healthy = True
        app.checked_at = time.monotonic()
        def request():
            return json.loads(b''.join(app(
                {'PATH_INFO': '/time', 'REQUEST_METHOD': 'GET'},
                lambda status, headers: self.assertEqual(status, '200 OK'))))
        self.assertNotIn('satellites', request())
        app.satellites = {'used': 6, 'visible': 10}
        app.satellites_at = time.monotonic()
        self.assertEqual(request()['satellites'], app.satellites)
        app.satellites_at -= 31
        self.assertNotIn('satellites', request())

    def test_health_requires_pps_stratum_and_recent_reference(self):
        now = 1791379451
        date = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime('%a %b %d %H:%M:%S %Y')
        report = f'Reference ID : 50505300 (PPS)\nStratum : 1\nRef time (UTC) : {date}\nLeap status : Normal\n'
        self.assertTrue(tracking_is_healthy(report, 'PPS', now))
        self.assertFalse(tracking_is_healthy(report, 'PPS', now + 121))
        self.assertFalse(tracking_is_healthy(report.replace('(PPS)', '(NMEA)'), 'PPS', now))
        self.assertFalse(tracking_is_healthy(report.replace('Normal', 'Not synchronised'), 'PPS', now))

    def test_bucket_recovers_without_stopping_service(self):
        with patch('clock.time.monotonic', return_value=10) as clock:
            bucket = TokenBucket()
            for _ in range(10):
                self.assertTrue(bucket.accept())
            self.assertFalse(bucket.accept())
            clock.return_value = 11
            self.assertTrue(bucket.accept())

    def test_unhealthy_and_arbitrary_requests_do_not_return_time(self):
        app = ClockApplication()
        statuses = []
        def request(**overrides):
            environ = {'PATH_INFO': '/time', 'REQUEST_METHOD': 'GET', **overrides}
            return app(environ, lambda status, headers: statuses.append(status))
        request()
        self.assertTrue(statuses[-1].startswith('503'))
        request(QUERY_STRING='url=http://192.168.3.1')
        self.assertTrue(statuses[-1].startswith('404'))
        request(REQUEST_METHOD='POST')
        self.assertTrue(statuses[-1].startswith('405'))
        app.healthy = True
        app.checked_at = time.monotonic()
        request()
        self.assertTrue(statuses[-1].startswith('200'))
        app.checked_at -= 31
        request()
        self.assertTrue(statuses[-1].startswith('503'))


if __name__ == '__main__':
    unittest.main()
