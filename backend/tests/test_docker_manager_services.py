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

    def test_inspect_folder_detects_compose(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            stack = managed / "myapp"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text("services:\n  web:\n    image: nginx:alpine\n", encoding="utf-8")
            manager = ComposeManager(managed_root=str(managed))
            data = manager.inspect_folder(str(stack))
            self.assertTrue(data["has_compose"])
            self.assertEqual(data["compose_file"], "docker-compose.yml")
            self.assertIn("nginx:alpine", data["compose_content"] or "")

    def test_inspect_managed_preview_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            manager = ComposeManager(managed_root=str(managed))
            target = managed / "newproj"
            data = manager.inspect_folder(str(target))
            self.assertFalse(data["exists"])
            self.assertFalse(data["has_compose"])
            self.assertTrue(data["writable"])

    def test_create_project_from_template(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            manager = ComposeManager(managed_root=str(managed))

            def fake_validate(path: str):
                return {"status": "success", "output": "ok"}

            with patch.object(manager, "validate", side_effect=fake_validate):
                project = manager.create_project(
                    project_name="demo",
                    folder_mode="managed",
                    source="template",
                    template={"image": "redis:7", "host_port": 6379, "container_port": 6379},
                )
            self.assertEqual(project["project_name"], "demo")
            compose_path = Path(project["compose_file"])
            self.assertTrue(compose_path.exists())
            self.assertIn("redis:7", compose_path.read_text(encoding="utf-8"))

    def test_create_project_paste_rejects_existing_without_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            manager = ComposeManager(managed_root=str(managed))
            stack = managed / "demo"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text("services:\n  web:\n    image: nginx:alpine\n", encoding="utf-8")
            with self.assertRaises(DockerManagerError):
                manager.create_project(
                    project_name="demo",
                    folder_mode="managed",
                    source="paste",
                    compose_content="services:\n  app:\n    image: alpine\n",
                    overwrite_compose=False,
                )

    def test_validate_compose_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager = ComposeManager(managed_root=str(Path(tmp) / "managed"))

            def fake_validate(path: str):
                return {"status": "success", "output": path}

            with patch.object(manager, "validate", side_effect=fake_validate) as mocked:
                result = manager.validate_compose_content("services:\n  web:\n    image: nginx:alpine\n")
                self.assertEqual(result["status"], "success")
                mocked.assert_called_once()

    def test_list_projects_and_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            stack = managed / "demo"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text("services:\n  web:\n    image: nginx:alpine\n", encoding="utf-8")
            (stack / ".env.example").write_text("FOO=bar\n", encoding="utf-8")
            manager = ComposeManager(managed_root=str(managed))

            with patch.object(manager, "_compose_project_statuses", return_value={"demo": "running"}):
                projects = manager.list_projects()
            self.assertEqual(len(projects), 1)
            self.assertEqual(projects[0]["id"], "demo")
            self.assertEqual(projects[0]["status"], "running")

            env = manager.get_env_at_path(str(stack))
            self.assertIn("FOO", env["content"])
            manager.update_env_at_path(str(stack), "FOO=baz\n")
            self.assertIn("baz", (stack / ".env").read_text(encoding="utf-8"))

    def test_update_compose_at_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            stack = managed / "demo"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text("services:\n  web:\n    image: nginx:alpine\n", encoding="utf-8")
            manager = ComposeManager(managed_root=str(managed))
            new_yaml = "services:\n  web:\n    image: redis:7\n"

            with patch.object(manager, "validate", return_value={"status": "success", "output": "ok"}):
                result = manager.update_compose_at_path(str(stack), new_yaml)
            self.assertTrue(result["validated"])
            self.assertIn("redis:7", (stack / "docker-compose.yml").read_text(encoding="utf-8"))

    def test_deploy_stack_builds_when_pull_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            managed = Path(tmp) / "managed"
            stack = managed / "app"
            stack.mkdir(parents=True)
            (stack / "docker-compose.yml").write_text(
                "services:\n  app:\n    image: boxysvg-app\n    build: .\n",
                encoding="utf-8",
            )
            manager = ComposeManager(managed_root=str(managed))
            self.assertTrue(manager.services_need_build(str(stack)))
            pull_fail = {
                "status": "error",
                "error": "pull access denied for boxysvg-app, repository does not exist",
                "output": "must be built from source by running docker compose build",
            }
            self.assertTrue(manager._pull_suggests_build(pull_fail))

            with patch.object(manager, "pull", return_value=pull_fail), patch.object(
                manager, "build", return_value={"status": "success", "output": "built"}
            ), patch.object(manager, "up", return_value={"status": "success", "output": "started"}):
                result = manager.deploy_stack(str(stack))
            self.assertEqual(result["status"], "success")
            self.assertTrue(result["built"])

    @patch("modules.docker_manager.logic.DockerService._run")
    def test_exec_requires_command(self, _mock_run):
        service = DockerService()
        with self.assertRaises(DockerManagerError):
            service.exec_command("abc", [])

    def test_normalize_stats_row(self):
        row = DockerService._normalize_stats_row(
            {
                "Container": "abc123",
                "Name": "demo",
                "CPUPerc": "12.5%",
                "MemUsage": "64MiB / 512MiB",
                "MemPerc": "12.50%",
                "NetIO": "1kB / 2kB",
                "BlockIO": "0B / 0B",
                "PIDs": "8",
            }
        )
        self.assertEqual(row["cpu"], "12.5%")
        self.assertEqual(row["mem_usage"], "64MiB / 512MiB")
        self.assertEqual(row["net_io"], "1kB / 2kB")
        self.assertEqual(row["name"], "demo")

    @patch("modules.docker_manager.logic.DockerService._run")
    def test_list_stats_parses_json_lines(self, mock_run):
        mock_run.return_value = type(
            "R",
            (),
            {
                "returncode": 0,
                "stdout": '{"Container":"c1","Name":"a","CPUPerc":"1%","MemUsage":"10MiB / 100MiB","MemPerc":"10%","NetIO":"1B / 2B","BlockIO":"0B / 0B","PIDs":"1"}\n',
                "stderr": "",
            },
        )()
        service = DockerService()
        rows = service.list_stats()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cpu"], "1%")

    def test_update_restart_policy_rejects_invalid(self):
        service = DockerService()
        with self.assertRaises(DockerManagerError):
            service.update_restart_policy("abc", "sometimes")

    @patch("modules.docker_manager.logic.DockerService._client", return_value=None)
    @patch("modules.docker_manager.logic.DockerService._run")
    def test_update_restart_policy_cli(self, mock_run, _mock_client):
        mock_run.return_value = type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        service = DockerService()
        result = service.update_restart_policy("abc123", "unless-stopped")
        self.assertEqual(result["restart_policy"], "unless-stopped")
        args = mock_run.call_args[0][0]
        self.assertIn("update", args)
        self.assertIn("--restart", args)
        self.assertIn("unless-stopped", args)

    @patch("modules.docker_manager.logic.DockerService._client", return_value=None)
    @patch("modules.docker_manager.logic.DockerService._run")
    def test_update_restart_policy_on_failure_retries(self, mock_run, _mock_client):
        mock_run.return_value = type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        service = DockerService()
        service.update_restart_policy("abc123", "on-failure", maximum_retry_count=5)
        args = mock_run.call_args[0][0]
        self.assertIn("on-failure:5", args)

    def test_parse_image_ref_library_and_user(self):
        service = DockerService()
        nginx = service._parse_image_ref("nginx:alpine")
        self.assertEqual(nginx["registry"], "docker.io")
        self.assertEqual(nginx["repository"], "library/nginx")
        self.assertEqual(nginx["tag"], "alpine")
        cf = service._parse_image_ref("cloudflare/cloudflared:latest")
        self.assertEqual(cf["repository"], "cloudflare/cloudflared")
        self.assertEqual(cf["tag"], "latest")

    def test_check_image_update_detects_newer_digest(self):
        service = DockerService()
        with patch.object(service, "local_image_digest", return_value="sha256:old"), patch.object(
            service, "remote_image_digest", return_value="sha256:new"
        ):
            result = service.check_image_update("nginx:alpine")
        self.assertTrue(result["update_available"])
        self.assertEqual(result["status"], "update_available")

    def test_check_image_update_up_to_date(self):
        service = DockerService()
        with patch.object(service, "local_image_digest", return_value="sha256:same"), patch.object(
            service, "remote_image_digest", return_value="sha256:same"
        ):
            result = service.check_image_update("nginx:alpine")
        self.assertFalse(result["update_available"])
        self.assertEqual(result["status"], "up_to_date")

    @patch("modules.docker_manager.logic.DockerService.pull_image", return_value="Downloaded newer image for nginx:alpine")
    def test_update_image_to_latest_reports_change(self, _mock_pull):
        service = DockerService()
        with patch.object(service, "local_image_digest", side_effect=["sha256:old", "sha256:new"]):
            result = service.update_image_to_latest("nginx:alpine")
        self.assertTrue(result["changed"])


if __name__ == "__main__":
    unittest.main()
