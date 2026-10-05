"""Failure paths for the 1-click site wizard."""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import MagicMock, patch

from core.jobs import jobs
from core.sysexec import CommandError, prepare_argv, run
from core.user_model import get_db_connection
from modules.database_manager.logic import DBManager
from modules.site_wizard.logic import (
    WizardRequest,
    _download_wordpress_core,
    _run_wizard_sync,
    derive_db_identifiers,
    run_wizard,
)
from modules.web_manager.logic import (
    UnknownPhpExtension,
    detect_nginx_style,
    detect_php_fpm_socket,
    ensure_php_fpm_socket,
    nginx_paths_for_root,
    php_extension_package,
    resolve_php_version,
)


def _job() -> MagicMock:
    job = MagicMock()
    job.log = MagicMock()
    job.update = MagicMock()
    return job


class PhpPackageTests(unittest.TestCase):
    def test_php_ext_package_names(self):
        self.assertEqual(php_extension_package("mysqli", "8.3", "apt"), "php8.3-mysql")
        self.assertEqual(php_extension_package("mysqli", "8.3", "rpm"), "php-mysqlnd")
        with self.assertRaises(UnknownPhpExtension):
            php_extension_package("not-a-real-ext", "8.3", "apt")

    def test_resolve_php_version(self):
        running = [{"version": "8.3", "status": "running"}]
        with patch("modules.web_manager.logic.list_php_fpm_versions", return_value=running):
            self.assertEqual(resolve_php_version("auto"), "8.3")
        with patch("modules.web_manager.logic.list_php_fpm_versions", return_value=[]), patch(
            "modules.web_manager.logic.get_active_php_version", return_value=""
        ), patch("modules.web_manager.logic.distro_default_php", return_value="8.3"), patch(
            "modules.web_manager.logic._is_php_version_installed", return_value=False
        ), patch("modules.web_manager.logic._php_version_installable", side_effect=lambda v: v == "8.3"):
            self.assertEqual(resolve_php_version(""), "8.3")
            with self.assertRaises(RuntimeError) as ctx:
                resolve_php_version("8.2")
        self.assertIn("8.2", str(ctx.exception))
        self.assertNotIn("falling back", str(ctx.exception).lower())

    def test_rhel_fpm_socket(self):
        def exists(path: str) -> bool:
            return path in {"/run/php-fpm/www.sock", "/var/run/php-fpm/www.sock"}

        with patch("modules.web_manager.logic.os.path.exists", side_effect=exists), patch(
            "modules.web_manager.logic.glob.glob", return_value=[]
        ):
            with patch("modules.web_manager.logic._php_cli_version", return_value="8.1"):
                self.assertEqual(detect_php_fpm_socket("8.1"), "/run/php-fpm/www.sock")
            with patch("modules.web_manager.logic._php_cli_version", return_value="8.3"):
                self.assertIsNone(detect_php_fpm_socket("8.1"))

    def test_explicit_php_does_not_fall_back(self):
        with patch("modules.web_manager.logic.detect_php_fpm_socket", return_value=None) as detect, patch(
            "modules.web_manager.logic._start_php_fpm"
        ):
            with self.assertRaises(RuntimeError) as ctx:
                ensure_php_fpm_socket("8.2")
        self.assertIn("8.2", str(ctx.exception))
        self.assertEqual(detect.call_args_list[0].args[0], "8.2")


class NginxLayoutTests(unittest.TestCase):
    def test_rhel_nginx_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "nginx.conf").write_text("http { include /etc/nginx/conf.d/*.conf; }\n", encoding="utf-8")
            (root / "conf.d").mkdir()
            self.assertEqual(detect_nginx_style(str(root)), "rhel")
            paths = nginx_paths_for_root(str(root))
            self.assertEqual(paths.style, "rhel")
            self.assertTrue(paths.sites_available.endswith(f"{os.sep}conf.d"))
            self.assertEqual(paths.sites_available, paths.sites_enabled)


class DatabaseReliabilityTests(unittest.TestCase):
    def test_no_mock_fallback_on_linux(self):
        env = os.environ.copy()
        env.pop("COPANEL_MOCK", None)
        with patch.dict(os.environ, env, clear=True), patch(
            "modules.database_manager.logic.IS_WINDOWS", False
        ), patch("modules.database_manager.logic.shutil.which", return_value=None):
            res = DBManager.create_database("appdb")
        self.assertEqual(res["status"], "error")
        self.assertIn("MySQL/MariaDB", res["message"])

    def test_db_user_unique(self):
        com_name, com_user = derive_db_identifiers("blog.mydomain.com")
        net_name, net_user = derive_db_identifiers("blog.mydomain.net")
        self.assertNotEqual(com_user, net_user)
        self.assertLessEqual(len(com_user), 32)
        self.assertLessEqual(len(net_user), 32)
        self.assertNotEqual(com_name, net_name)

    def test_db_user_collision_refused(self):
        with patch("modules.database_manager.logic.shutil.which", return_value="/usr/bin/mysql"), patch(
            "modules.database_manager.logic.DBManager.user_databases", return_value=["other_site"]
        ), patch("modules.database_manager.logic.subprocess.run") as mocked:
            res = DBManager.ensure_site_user("blog_user", "localhost", "password1", "blog_db")
        self.assertEqual(res["status"], "error")
        self.assertIn("other_site", res["message"])
        mocked.assert_not_called()


class WizardFailureTests(unittest.TestCase):
    def test_pkg_install_failure_fails_job(self):
        req = WizardRequest(
            domain="example.com",
            document_root="/var/www/example.com",
            template_id="static",
            issue_ssl=False,
        )
        with patch("modules.site_wizard.logic._nginx_ready", return_value=False), patch(
            "modules.site_wizard.logic.sysexec.pkg_install",
            return_value={"ok": False, "missing": ["nginx"], "output_tail": "E: Unable to locate package nginx"},
        ):
            with self.assertRaises(RuntimeError) as ctx:
                _run_wizard_sync(_job(), req)
        self.assertIn("nginx", str(ctx.exception))

    def _stack(self, root: str, *, vhost, create_site, db_exists: bool, user_result: dict):
        stack = ExitStack()
        stack.enter_context(patch("modules.site_wizard.logic._validate_doc_root", return_value=root))
        stack.enter_context(patch("modules.site_wizard.logic._ensure_stack", return_value=""))
        stack.enter_context(patch("modules.site_wizard.logic._apply_site_ownership", return_value="www-data"))
        stack.enter_context(
            patch(
                "modules.site_wizard.logic._http_verify",
                return_value={"reachable": True, "status_line": "HTTP/1.1 200 OK"},
            )
        )
        stack.enter_context(patch("modules.ssl_manager.logic.SSLManager.find_nginx_vhost_path", return_value=vhost))
        stack.enter_context(patch("modules.web_manager.router.create_site", create_site))
        stack.enter_context(patch("modules.database_manager.logic.DBManager.database_exists", return_value=db_exists))
        stack.enter_context(
            patch("modules.database_manager.logic.DBManager.create_database", return_value={"status": "success"})
        )
        stack.enter_context(patch("modules.database_manager.logic.DBManager.ensure_site_user", return_value=user_result))
        delete_db = stack.enter_context(
            patch("modules.database_manager.logic.DBManager.delete_database", return_value={"status": "success"})
        )
        undo_vhost = stack.enter_context(patch("modules.site_wizard.logic._rollback_vhost"))
        stack.enter_context(
            patch(
                "modules.site_wizard.logic._deploy_template_app",
                return_value={"template": "static", "deployed": "static_placeholder", "status": "success"},
            )
        )
        return stack, delete_db, undo_vhost

    def test_rollback_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = str(Path(tmp) / "site")
            create_site = MagicMock(return_value={"status": "success"})
            user_fail = {"status": "error", "message": "mysql down"}
            req = WizardRequest(domain="example.com", document_root=root, template_id="static", create_database=True)
            stack, delete_db, undo_vhost = self._stack(
                root, vhost=None, create_site=create_site, db_exists=False, user_result=user_fail
            )
            with stack:
                with self.assertRaises(RuntimeError) as ctx:
                    _run_wizard_sync(_job(), req)
            self.assertIn("mysql down", str(ctx.exception))
            self.assertIn("Rolled back", str(ctx.exception))
            undo_vhost.assert_called()
            delete_db.assert_called()

            stack, delete_db, undo_vhost = self._stack(
                root, vhost=None, create_site=create_site, db_exists=True, user_result=user_fail
            )
            with stack:
                with self.assertRaises(RuntimeError):
                    _run_wizard_sync(_job(), req)
            delete_db.assert_not_called()
            undo_vhost.assert_called()

    def test_ssl_skipped_when_dns_not_pointing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = str(Path(tmp) / "site")
            create_site = MagicMock(return_value={"status": "success"})
            stack, _delete_db, _undo = self._stack(
                root,
                vhost=None,
                create_site=create_site,
                db_exists=False,
                user_result={"status": "success", "created": True},
            )
            req = WizardRequest(
                domain="example.com",
                document_root=root,
                template_id="static",
                issue_ssl=True,
                ssl_email="admin@example.com",
            )
            stack.enter_context(
                patch(
                    "modules.site_wizard.logic.dns_points_here",
                    return_value={"dns_ok": False, "reason": "no match"},
                )
            )
            issue = stack.enter_context(patch("modules.ssl_manager.logic.SSLManager.issue_certbot"))
            with stack:
                result = _run_wizard_sync(_job(), req)
            issue.assert_not_called()
            self.assertEqual(result["ssl"]["status"], "skipped")

    def test_rerun_reuses_vhost_and_keeps_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "site"
            root.mkdir()
            (root / "wp-includes").mkdir()
            (root / "wp-includes" / "version.php").write_text("<?php", encoding="utf-8")
            (root / "wp-config.php").write_text("<?php", encoding="utf-8")
            vhost = Path(tmp) / "example.com.conf"
            vhost.write_text(
                f"server {{\n    root {root};\n    location ~ \\.php$ {{\n        fastcgi_pass unix:/run/php/php8.3-fpm.sock;\n    }}\n}}\n",
                encoding="utf-8",
            )
            create_site = MagicMock(return_value={"status": "success"})
            user = {"status": "success", "created": False, "password_unchanged": True, "message": "kept"}
            req = WizardRequest(
                domain="example.com",
                document_root=str(root),
                template_id="wordpress",
                php_version="8.3",
                create_database=True,
                issue_ssl=False,
            )
            with patch("modules.site_wizard.logic._validate_doc_root", return_value=str(root)), patch(
                "modules.site_wizard.logic._ensure_stack", return_value="8.3"
            ), patch("modules.site_wizard.logic._ensure_vhost_php_fpm"), patch(
                "modules.site_wizard.logic._apply_site_ownership", return_value="www-data"
            ), patch(
                "modules.site_wizard.logic._http_verify",
                return_value={"reachable": True, "status_line": "HTTP/1.1 200 OK"},
            ), patch(
                "modules.ssl_manager.logic.SSLManager.find_nginx_vhost_path", return_value=vhost
            ), patch("modules.web_manager.router.create_site", create_site), patch(
                "modules.database_manager.logic.DBManager.database_exists", return_value=True
            ), patch("modules.database_manager.logic.DBManager.create_database") as create_db, patch(
                "modules.database_manager.logic.DBManager.ensure_site_user", return_value=user
            ) as ensure, patch(
                "modules.database_manager.logic.DBManager.create_user"
            ) as create_user, patch(
                "modules.site_wizard.logic._deploy_template_app",
                return_value={"template": "wordpress", "deployed": "wordpress_core", "status": "success"},
            ):
                result = _run_wizard_sync(_job(), req)
            create_site.assert_not_called()
            create_db.assert_not_called()
            create_user.assert_not_called()
            ensure.assert_called()
            self.assertIsNone(result["database"]["password"])


class DownloadTests(unittest.TestCase):
    def test_temp_dir_per_job(self):
        seen: list[str] = []
        real = tempfile.mkdtemp

        def wrapped(*args, **kwargs):
            path = real(*args, **kwargs)
            seen.append(path)
            return path

        def boom(_url, dest, **_kwargs):
            Path(dest).write_bytes(b"x")
            raise RuntimeError("download failed")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "doc"
            root.mkdir()
            with patch("modules.site_wizard.logic.tempfile.mkdtemp", side_effect=wrapped), patch(
                "modules.site_wizard.logic._wordpress_files_present", return_value=False
            ), patch("modules.site_wizard.logic._download_https", side_effect=boom):
                for job_id in ("job-a", "job-b"):
                    with self.assertRaises(RuntimeError):
                        _download_wordpress_core(root, job_id)
        self.assertEqual(len(seen), 2)
        self.assertNotEqual(seen[0], seen[1])
        for path in seen:
            self.assertFalse(Path(path).exists())

    def test_wp_checksum_mismatch_fails(self):
        def fake_download(_url, dest, **_kwargs):
            Path(dest).write_bytes(b"not-a-tarball")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch("modules.site_wizard.logic._wordpress_files_present", return_value=False), patch(
                "modules.site_wizard.logic._download_https", side_effect=fake_download
            ), patch("modules.site_wizard.logic._download_text", return_value="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"):
                with self.assertRaises(RuntimeError) as ctx:
                    _download_wordpress_core(root, "job")
        self.assertIn("checksum", str(ctx.exception).lower())


class JobAndExecTests(unittest.TestCase):
    def test_orphan_jobs_marked_failed_on_start(self):
        job_id = "orphan-" + uuid.uuid4().hex[:8]
        conn = get_db_connection()
        try:
            conn.execute(
                "INSERT INTO jobs (id, kind, title, status, progress, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (job_id, "site_wizard.run", "orphan", "running", 40, time.time()),
            )
            conn.commit()
        finally:
            conn.close()
        ids = jobs.fail_orphaned_jobs()
        self.assertIn(job_id, ids)
        conn = get_db_connection()
        try:
            row = conn.execute("SELECT status, error FROM jobs WHERE id = ?", (job_id,)).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "Interrupted: CoPanel restarted while job was running")

    def test_no_sudo_when_root(self):
        with patch("core.sysexec.is_root", return_value=True), patch("core.sysexec.shutil.which", return_value=None):
            argv = prepare_argv(["sudo", "-n", "apt-get", "install", "-y", "nginx"], as_root=True)
            self.assertNotIn("sudo", argv)
            with patch("core.sysexec.subprocess.run") as mocked:
                mocked.return_value.returncode = 0
                mocked.return_value.stdout = ""
                mocked.return_value.stderr = ""
                run(["nginx", "-t"], timeout=5, as_root=True)
            called = mocked.call_args.args[0]
            self.assertEqual(called[0], "nginx")
            self.assertNotIn("sudo", called)
        with patch("core.sysexec.is_root", return_value=False), patch("core.sysexec.shutil.which", return_value=None):
            with self.assertRaises(CommandError):
                prepare_argv(["apt-get", "install", "nginx"], as_root=True)


class EventLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_loop_not_blocked(self):
        def slow(*_args, **_kwargs):
            time.sleep(2)
            return {"ok": True}

        ran: list[float] = []

        async def other() -> None:
            await asyncio.sleep(0.05)
            ran.append(time.monotonic())

        req = WizardRequest(domain="example.com", document_root="/var/www/example.com")
        with patch("modules.site_wizard.logic._run_wizard_sync", side_effect=slow):
            start = time.monotonic()
            task = asyncio.create_task(run_wizard(_job(), req))
            await other()
            self.assertLess(time.monotonic() - start, 0.5)
            self.assertTrue(ran)
            await task


if __name__ == "__main__":
    unittest.main()
