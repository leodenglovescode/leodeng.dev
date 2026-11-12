import datetime
import json
import time
import unittest
from unittest.mock import patch
from clock import ClockApplication, TokenBucket, satellite_counts, tracking_is_healthy


class ClockTests(unittest.TestCase):
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
