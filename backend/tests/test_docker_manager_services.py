import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.docker_manager.compose_manager import ComposeManager
from modules.docker_manager.logic import DockerManagerError, DockerService


class DockerManagerServiceTests(unittest.TestCase):
    def test_compose_scan_detects_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            stack = base / "sample"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text("services:\n  web:\n    image: nginx:alpine\n", encoding="utf-8")
            manager = ComposeManager(managed_root=str(base / "managed"))
            files = manager.scan_compose_files(custom_path=str(base))
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]["source"], "discovered")

    def test_invalid_stack_id_rejected(self):
        manager = ComposeManager(managed_root=tempfile.gettempdir())
        with self.assertRaises(DockerManagerError):
            manager.init_stack("../oops", "nginx:alpine", 8080, 80)

    @patch("modules.docker_manager.logic.DockerService._run")
    def test_exec_requires_command(self, _mock_run):
        service = DockerService()
        with self.assertRaises(DockerManagerError):
            service.exec_command("abc", [])


if __name__ == "__main__":
    unittest.main()
