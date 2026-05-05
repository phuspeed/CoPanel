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


if __name__ == "__main__":
    unittest.main()
