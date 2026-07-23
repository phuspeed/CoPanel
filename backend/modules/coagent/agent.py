"""CoAgent ReAct loop with OpenAI-compatible function calling + HITL gate."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import pending_actions
from .config_store import load_config
from .sanitizers import SanitizeError
from .tools import (
    TOOL_DEFS,
    build_action_preview,
    execute_tool,
    is_readonly,
    tool_result_for_llm,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Bạn là CoAgent — trợ lý SysAdmin thông minh của CoPanel (Linux VPS control panel).
Trả lời bằng tiếng Việt, rõ ràng, ngắn gọn, có cấu trúc (bullet/markdown khi hữu ích).

Quy tắc bắt buộc:
1. Chẩn đoán trước khi sửa: ưu tiên dùng tool READ-ONLY (get_system_metrics, get_service_status, read_system_logs).
2. Với thao tác thay đổi hệ thống (restart_service, clear_system_cache, manage_nginx_vhost, manage_firewall_port):
   hãy gọi tool đó khi cần — hệ thống sẽ YÊU CẦU người dùng xác nhận trước khi thực thi.
   KHÔNG khẳng định đã thực thi thành công nếu chưa có xác nhận.
3. Không bịa output lệnh. Chỉ dựa vào kết quả tool.
4. Không yêu cầu chạy shell tùy ý; chỉ dùng các tool được cung cấp.
5. Khi nghi ngờ 502/504: kiểm tra nginx/upstream service + logs + tài nguyên.
6. An toàn: không đề xuất khóa cổng SSH (22) hoặc cổng panel (8686).
"""


class AgentError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _get_openai_client(cfg: Dict[str, Any]):
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise AgentError(
            "OPENAI_SDK_MISSING",
            "Python package 'openai' is not installed on the server.",
        ) from exc

    api_key = (cfg.get("api_key") or "").strip()
    base_url = (cfg.get("base_url") or "").strip()
    if not api_key:
        raise AgentError(
            "COAGENT_NOT_CONFIGURED",
            "Chưa cấu hình API key cho CoAgent. Vào Settings của CoAgent để nhập Base URL / API Key / Model.",
        )
    if not base_url:
        raise AgentError("COAGENT_NOT_CONFIGURED", "Chưa cấu hình Base URL cho CoAgent.")

    return OpenAI(api_key=api_key, base_url=base_url)


def _normalize_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages or []:
        role = (m.get("role") or "").strip()
        content = m.get("content")
        if role not in ("user", "assistant", "system"):
            continue
        if content is None:
            continue
        text = str(content).strip()
        if not text:
            continue
        if role == "system":
            # Ignore client-supplied system; we inject our own.
            continue
        out.append({"role": role, "content": text[:12000]})
    if not out:
        raise AgentError("EMPTY_MESSAGES", "Tin nhắn trống.")
    # Keep last N turns to bound context
    return out[-24:]


def _parse_tool_args(raw: Any) -> Dict[str, Any]:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def run_chat(
    messages: List[Dict[str, Any]],
    *,
    username: Optional[str] = None,
) -> Dict[str, Any]:
    """Run ReAct loop. Auto-executes READ tools; parks ACTION tools as pending."""
    cfg = load_config()
    if not cfg.get("enabled", True):
        raise AgentError("COAGENT_DISABLED", "CoAgent đang bị tắt trong cấu hình.")

    client = _get_openai_client(cfg)
    model = cfg.get("model") or "gpt-4o-mini"
    max_rounds = int(cfg.get("max_tool_rounds") or 6)

    history = _normalize_messages(messages)
    llm_messages: List[Dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
    ]

    pending: List[Dict[str, Any]] = []
    tool_trace: List[Dict[str, Any]] = []

    for _round in range(max_rounds):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=llm_messages,
                tools=TOOL_DEFS,
                tool_choice="auto",
                temperature=0.2,
            )
        except Exception as exc:
            logger.exception("CoAgent LLM call failed")
            raise AgentError("LLM_ERROR", f"Lỗi gọi AI API: {exc}") from exc

        choice = resp.choices[0].message
        tool_calls = getattr(choice, "tool_calls", None) or []

        if not tool_calls:
            reply = (choice.content or "").strip() or "Tôi chưa có thêm thông tin để trả lời."
            return {
                "reply": reply,
                "pending_actions": pending,
                "tool_trace": tool_trace,
            }

        # Serialize assistant message with tool_calls for continuity
        assistant_msg: Dict[str, Any] = {
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments or "{}",
                    },
                }
                for tc in tool_calls
            ],
        }
        llm_messages.append(assistant_msg)

        action_calls = []
        read_calls = []
        for tc in tool_calls:
            name = tc.function.name
            if is_readonly(name):
                read_calls.append(tc)
            else:
                action_calls.append(tc)

        # Execute READ tools immediately
        for tc in read_calls:
            name = tc.function.name
            args = _parse_tool_args(tc.function.arguments)
            result = execute_tool(name, args)
            tool_trace.append({"tool": name, "args": args, "result_ok": bool(result.get("ok"))})
            llm_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result_for_llm(result),
                }
            )

        # Park ACTION tools — do not execute
        if action_calls:
            for tc in action_calls:
                name = tc.function.name
                args = _parse_tool_args(tc.function.arguments)
                try:
                    preview = build_action_preview(name, args)
                    proposal = pending_actions.create_pending(
                        tool=preview["tool"],
                        args=preview["args"],
                        title=preview["title"],
                        command_preview=preview["command_preview"],
                        risk=preview["risk"],
                        created_by=username,
                    )
                    pending.append(proposal)
                    # Feed a stub tool result so the model can explain the proposal
                    stub = {
                        "ok": True,
                        "pending_confirmation": True,
                        "summary": (
                            f"Hành động '{preview['title']}' đã được đề xuất. "
                            "Chờ người dùng nhấn Đồng ý trên UI trước khi thực thi."
                        ),
                        "command_preview": preview["command_preview"],
                    }
                    llm_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": tool_result_for_llm(stub),
                        }
                    )
                    tool_trace.append(
                        {
                            "tool": name,
                            "args": preview["args"],
                            "result_ok": True,
                            "pending": True,
                        }
                    )
                except SanitizeError as exc:
                    err = {"ok": False, "error": str(exc), "summary": str(exc)}
                    llm_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": tool_result_for_llm(err),
                        }
                    )
                    tool_trace.append({"tool": name, "args": args, "result_ok": False})

            # One more LLM turn to produce a user-facing explanation, without more tools ideally
            try:
                final = client.chat.completions.create(
                    model=model,
                    messages=llm_messages
                    + [
                        {
                            "role": "system",
                            "content": (
                                "Đã có thao tác đang chờ xác nhận của người dùng. "
                                "Hãy giải thích ngắn gọn những gì bạn phát hiện và thao tác đề xuất. "
                                "Nhắc người dùng nhấn Đồng ý / Hủy trên giao diện. Không gọi thêm tool."
                            ),
                        }
                    ],
                    temperature=0.2,
                )
                reply = (final.choices[0].message.content or "").strip()
            except Exception:
                reply = (
                    "Tôi đã chuẩn bị thao tác hệ thống cần xác nhận của bạn. "
                    "Vui lòng xem thẻ xác nhận bên dưới và chọn Đồng ý hoặc Hủy."
                )
            if not reply:
                reply = "Có thao tác đang chờ bạn xác nhận."
            return {
                "reply": reply,
                "pending_actions": pending,
                "tool_trace": tool_trace,
            }

        # Continue loop with read results only

    return {
        "reply": (
            "Tôi đã đạt giới hạn số vòng phân tích tool. "
            "Hãy thử hỏi cụ thể hơn hoặc xác nhận các thao tác đang chờ (nếu có)."
        ),
        "pending_actions": pending,
        "tool_trace": tool_trace,
    }


def execute_pending_action(action_id: str) -> Dict[str, Any]:
    entry = pending_actions.consume_pending(action_id)
    if not entry:
        raise AgentError(
            "ACTION_NOT_FOUND",
            "Action không tồn tại, đã hết hạn, hoặc đã được sử dụng.",
        )
    result = execute_tool(entry["tool"], entry.get("args") or {})
    return {
        "action_id": action_id,
        "tool": entry["tool"],
        "args": entry.get("args"),
        "title": entry.get("title"),
        "result": result,
    }
