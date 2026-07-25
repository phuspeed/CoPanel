import unittest
from unittest.mock import patch

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from modules.docker_manager.router import router
    FASTAPI_AVAILABLE = True
except Exception:
    FASTAPI_AVAILABLE = False


class DockerManagerRouterBackwardCompatTests(unittest.TestCase):
    def setUp(self):
        if not FASTAPI_AVAILABLE:
            self.skipTest("FastAPI dependencies are not available in test environment")
        app = FastAPI()
        app.include_router(router, prefix="/api/docker_manager")
        self.client = TestClient(app)

    @patch("modules.docker_manager.router.docker_service.list_containers")
    def test_list_endpoint_kept(self, mock_list):
        mock_list.return_value = ([{"id": "abc", "name": "demo", "image": "nginx", "status": "running", "ports": "-"}], False)
        response = self.client.get("/api/docker_manager/list")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertIn("containers", body)

    @patch("modules.docker_manager.router.docker_service.list_stats")
    def test_stats_endpoint(self, mock_stats):
        mock_stats.return_value = [{"id": "abc", "name": "demo", "cpu": "1%", "mem_usage": "10MiB / 100MiB", "net_io": "1B / 2B"}]
        response = self.client.get("/api/docker_manager/stats")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(len(body["data"]), 1)


if __name__ == "__main__":
    unittest.main()
