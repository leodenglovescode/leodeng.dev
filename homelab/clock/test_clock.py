import datetime
import time
import unittest
from unittest.mock import patch
from clock import ClockApplication, TokenBucket, tracking_is_healthy


class ClockTests(unittest.TestCase):
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
