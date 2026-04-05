const fs = require('fs');
const cells = [];

const BT = '`';
const BT3 = '```';

function md(source) {
  cells.push({
    cell_type: 'markdown', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l)
  });
}

function code(source) {
  cells.push({
    cell_type: 'code', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l),
    outputs: [], execution_count: null
  });
}

// ============================================================
// Notebook 05: Query Engine - The Conversation Loop
// ============================================================

md(`# Chapter 5: Query Engine -- The Conversation Loop

**In this chapter you will learn:**
- How the agentic conversation loop works (the core of Claude Code)
- Message types and their roles in the API protocol
- Tool orchestration: tool_use -> execute -> tool_result -> continue
- Streaming simulation and content delta events
- Context compaction when the window fills up
- Building a complete ${BT}QueryEngine${BT} class in Python

> **Source:** ${BT}query.ts${BT} (L219-L1729), ${BT}QueryEngine.ts${BT} (L184-L1178)

---

## 1. Why simple request-response doesn't work

Imagine a user asks Claude to "read a file and summarize it." A single API call won't
suffice because the model first needs to call the ${BT}Read${BT} tool, then see the
result, and only then produce the summary.
`);

md(`### The pain point

${BT3}python
# Naive approach: one API call
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Read main.py and summarize it"}],
)
# Problem: the model returns a tool_use block, not the answer!
# We need a LOOP that:
#   1. Sends messages to the API
#   2. Checks if the response contains tool_use blocks
#   3. Executes those tools
#   4. Adds tool_result back to messages
#   5. Calls the API again
#   6. Repeats until the model returns a text-only response
${BT3}

This is the **agentic loop pattern** -- the heart of every AI agent framework.

${BT3}mermaid
sequenceDiagram
    participant U as User
    participant Q as Query Loop
    participant A as Anthropic API
    participant T as Tool Executor

    U->>Q: "Read main.py and summarize"
    Q->>A: messages=[user_msg] + tools=[Read, Bash, ...]
    A-->>Q: assistant_msg with tool_use: {name: "Read", input: {file_path: "main.py"}}
    Q->>T: execute Read tool
    T-->>Q: tool_result: "file contents..."
    Q->>A: messages=[user_msg, assistant_msg, tool_result_msg]
    A-->>Q: assistant_msg with text: "Here's the summary..."
    Q->>U: Display summary
${BT3}
`);

md(`## 2. Message types

The Anthropic Messages API uses a set of message and content block types.
Claude Code defines its own internal types that wrap these.

> **Source:** ${BT}utils/messages.ts${BT}, SDK types from ${BT}@anthropic-ai/sdk${BT}

### Message roles

| Type | Role | Purpose |
|------|------|---------|
| ${BT}UserMessage${BT} | ${BT}"user"${BT} | User input, tool results, attachments |
| ${BT}AssistantMessage${BT} | ${BT}"assistant"${BT} | Model response (text + tool_use blocks) |
| ${BT}SystemMessage${BT} | Internal | Compact boundaries, API errors, metadata |

### Content blocks within messages

| Block Type | Found In | Purpose |
|------------|----------|---------|
| ${BT}text${BT} | User, Assistant | Plain text content |
| ${BT}tool_use${BT} | Assistant | Model requests to invoke a tool |
| ${BT}tool_result${BT} | User | Result of a tool execution |
| ${BT}thinking${BT} | Assistant | Extended thinking content |
| ${BT}image${BT} | User | Image content |

### The critical pair: tool_use and tool_result

${BT3}python
# tool_use block (from assistant message)
tool_use_block = {
    "type": "tool_use",
    "id": "toolu_01A09q90qw90lq917835lq9",
    "name": "Read",              # which tool to call
    "input": {                    # tool arguments
        "file_path": "/src/main.py"
    }
}

# tool_result block (sent back as user message content)
tool_result_block = {
    "type": "tool_result",
    "tool_use_id": "toolu_01A09q90qw90lq917835lq9",  # must match!
    "content": "import os\\nprint('hello')",            # tool output
    "is_error": false                                   # error flag
}
${BT3}
`);

code(`# === Message type definitions in Python ===
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal, Union
import json
import uuid
import time


@dataclass
class TextBlock:
    """Plain text content block."""
    type: str = "text"
    text: str = ""


@dataclass
class ToolUseBlock:
    """Model requests tool execution. Source: SDK ToolUseBlock."""
    type: str = "tool_use"
    id: str = ""
    name: str = ""
    input: dict = field(default_factory=dict)


@dataclass
class ToolResultBlock:
    """Result of tool execution sent back to model. Source: SDK ToolResultBlockParam."""
    type: str = "tool_result"
    tool_use_id: str = ""
    content: str | list[dict] = ""
    is_error: bool = False


ContentBlock = Union[TextBlock, ToolUseBlock, ToolResultBlock]


@dataclass
class Message:
    """Base message type. Source: types/message.ts"""
    role: Literal["user", "assistant"]
    content: list[ContentBlock] = field(default_factory=list)


def make_user_message(*blocks: ContentBlock) -> Message:
    """Create a user message with given content blocks."""
    return Message(role="user", content=list(blocks))


def make_assistant_message(*blocks: ContentBlock) -> Message:
    """Create an assistant message with given content blocks."""
    return Message(role="assistant", content=list(blocks))


def make_text_user_message(text: str) -> Message:
    """Convenience: create a user message with a single text block."""
    return make_user_message(TextBlock(text=text))


# Demonstrate message types
print("=== Message Types ===")
print()

user_msg = make_text_user_message("Read main.py and summarize it")
print(f"User message: role={user_msg.role}, blocks={len(user_msg.content)}")
print(f"  First block: type={user_msg.content[0].type}, text='{user_msg.content[0].text[:40]}...'")
print()

# Assistant responds with tool_use
assistant_msg = make_assistant_message(
    TextBlock(text="I'll read that file for you."),
    ToolUseBlock(id="toolu_abc123", name="Read", input={"file_path": "/src/main.py"})
)
print(f"Assistant message: role={assistant_msg.role}, blocks={len(assistant_msg.content)}")
for block in assistant_msg.content:
    if block.type == "tool_use":
        print(f"  ToolUse: name={block.name}, input={block.input}")
    else:
        print(f"  Text: '{block.text[:40]}...'")
print()

# User sends back tool_result
tool_result_msg = make_user_message(
    ToolResultBlock(tool_use_id="toolu_abc123", content="import os\\nprint('hello')")
)
print(f"Tool result message: role={tool_result_msg.role}")
print(f"  ToolResult: tool_use_id={tool_result_msg.content[0].tool_use_id}")
print(f"  Content: '{tool_result_msg.content[0].content}'")
`);

md(`## 3. The Query Loop

The query loop is the core algorithm of Claude Code. It's implemented as an
async generator in ${BT}query.ts${BT} (L219-L1729, ~1500 lines).

### Simplified algorithm

${BT3}mermaid
flowchart TD
    START([User sends message]) --> BUILD["Build messages array<br/>+ system prompt"]
    BUILD --> CALL["Call Anthropic API<br/>(streaming)"]
    CALL --> CHECK{"Response contains<br/>tool_use blocks?"}
    CHECK -- Yes --> EXEC["Execute tools<br/>(permission checks, etc.)"]
    EXEC --> RESULT["Add tool_result<br/>to messages"]
    RESULT --> COMPACT{"Context window<br/>full?"}
    COMPACT -- Yes --> SUMMARIZE["Compact: summarize<br/>old messages"]
    SUMMARIZE --> CALL
    COMPACT -- No --> CALL
    CHECK -- No --> DONE["Return text response<br/>to user"]
    DONE([End of turn])
${BT3}

### Key details from the source

The real ${BT}query()${BT} function handles many edge cases:
- **Streaming**: responses arrive as SSE events, not a single blob
- **Model fallback**: if the primary model fails, retry with a fallback
- **Max output tokens recovery**: if output is truncated, continue with a recovery message
- **Stop hooks**: post-processing hooks that can block or modify the response
- **Abort handling**: user can interrupt mid-stream (Ctrl+C)
`);

code(`# === Simplified Query Loop Implementation ===
import asyncio
from typing import AsyncGenerator


# --- Simulated API client ---
# In the real Claude Code, this calls the Anthropic Messages API.
# We simulate it to demonstrate the loop without requiring an API key.

class SimulatedAPIClient:
    """
    Simulates the Anthropic Messages API.
    The real implementation is in services/api/claude.ts
    """

    def __init__(self):
        self.call_count = 0
        # Simulated file system for the Read tool
        self.fake_files = {
            "/src/main.py": "import os\\nimport sys\\n\\ndef main():\\n    print('Hello from Claude Code!')\\n    print(f'Python {sys.version}')\\n\\nif __name__ == '__main__':\\n    main()",
            "/src/utils.py": "def helper(x):\\n    return x * 2",
        }

    async def create_message(
        self,
        messages: list[Message],
        system_prompt: str = "",
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """
        Simulate streaming API response.
        Yields content blocks one at a time.

        The real API returns SSE events:
          message_start, content_block_start, content_block_delta,
          content_block_stop, message_delta, message_stop
        """
        self.call_count += 1
        last_user_msg = None
        for msg in reversed(messages):
            if msg.role == "user":
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        last_user_msg = block.text
                        break
                if last_user_msg:
                    break

        # Check if we have pending tool results
        last_tool_result = None
        for msg in reversed(messages):
            if msg.role == "user":
                for block in msg.content:
                    if isinstance(block, ToolResultBlock):
                        last_tool_result = block.content
                        break

        if last_tool_result and self.call_count <= 3:
            # We have tool results, now provide a text summary
            yield {
                "type": "content_block",
                "block": TextBlock(
                    text=f"Based on the file contents, here is a summary:\\n\\n"
                         f"The code contains a main function that prints a greeting "
                         f"and Python version information. It uses standard library "
                         f"modules (os, sys). The structure is clean with a proper "
                         f"${BT}if __name__ == '__main__'${BT} guard."
                )
            }
        elif last_user_msg and "read" in last_user_msg.lower():
            # First call: model decides to use a tool
            yield {
                "type": "content_block",
                "block": TextBlock(text="I'll read that file for you.")
            }
            yield {
                "type": "content_block",
                "block": ToolUseBlock(
                    id=f"toolu_{uuid.uuid4().hex[:12]}",
                    name="Read",
                    input={"file_path": "/src/main.py"}
                )
            }
        else:
            # Fallback text response
            yield {
                "type": "content_block",
                "block": TextBlock(text="How can I help you?")
            }


# --- Tool executor ---
class SimpleToolExecutor:
    """
    Executes tools and returns results.
    The real implementation is in services/tools/toolOrchestration.ts
    """

    def __init__(self, api_client: SimulatedAPIClient):
        self.api_client = api_client

    async def execute(self, tool_use: ToolUseBlock) -> ToolResultBlock:
        """Execute a tool and return the result."""
        if tool_use.name == "Read":
            file_path = tool_use.input.get("file_path", "")
            content = self.api_client.fake_files.get(
                file_path,
                f"Error: File not found: {file_path}"
            )
            return ToolResultBlock(
                tool_use_id=tool_use.id,
                content=content,
                is_error=file_path not in self.api_client.fake_files
            )
        else:
            return ToolResultBlock(
                tool_use_id=tool_use.id,
                content=f"Unknown tool: {tool_use.name}",
                is_error=True
            )


print("SimulatedAPIClient and SimpleToolExecutor defined!")
print("These simulate the real API and tool execution without network calls.")
`);

md(`## 4. The core loop in Python

Now let's implement the heart of the query engine -- the agentic loop
that processes tool_use blocks iteratively.

> **Source:** ${BT}query.ts${BT} L307-L1728 (${BT}while (true)${BT} loop with state management)
`);

code(`# === The Agentic Loop ===

class QueryLoop:
    """
    Python implementation of the query loop.
    Source: query.ts L219-L1729

    The real implementation is ~1500 lines handling:
    - Streaming SSE parsing
    - Model fallback
    - Max output token recovery
    - Auto-compaction
    - Stop hooks
    - Abort handling
    - Token budget tracking

    Our simplified version demonstrates the core pattern.
    """

    def __init__(
        self,
        api_client: SimulatedAPIClient,
        tool_executor: SimpleToolExecutor,
        system_prompt: str = "You are a helpful coding assistant.",
        max_turns: int = 10,
    ):
        self.api_client = api_client
        self.tool_executor = tool_executor
        self.system_prompt = system_prompt
        self.max_turns = max_turns
        self.conversation: list[Message] = []

    async def run(self, user_text: str) -> str:
        """
        Run a complete query turn.

        This corresponds to the while(true) loop in query.ts L307.
        Each iteration either:
          1. Gets a text response (done)
          2. Gets tool_use blocks -> execute -> continue
        """
        # Add user message
        self.conversation.append(make_text_user_message(user_text))

        turn_count = 0
        final_text = ""

        while turn_count < self.max_turns:
            turn_count += 1
            print(f"  [Turn {turn_count}] Calling API with {len(self.conversation)} messages...")

            # Step 1: Call the API (simulated streaming)
            assistant_blocks: list[ContentBlock] = []
            tool_use_blocks: list[ToolUseBlock] = []

            async for event in self.api_client.create_message(
                messages=self.conversation,
                system_prompt=self.system_prompt,
            ):
                block = event["block"]
                assistant_blocks.append(block)
                if isinstance(block, ToolUseBlock):
                    tool_use_blocks.append(block)

            # Add assistant message to conversation
            assistant_msg = make_assistant_message(*assistant_blocks)
            self.conversation.append(assistant_msg)

            # Step 2: Check if we need to execute tools
            if not tool_use_blocks:
                # No tool calls -- extract text and return
                for block in assistant_blocks:
                    if isinstance(block, TextBlock):
                        final_text += block.text
                print(f"  [Turn {turn_count}] Got text response (no tool calls)")
                break

            # Step 3: Execute tools and collect results
            print(f"  [Turn {turn_count}] Model requested {len(tool_use_blocks)} tool call(s)")
            result_blocks: list[ToolResultBlock] = []
            for tool_use in tool_use_blocks:
                print(f"    Executing: {tool_use.name}({json.dumps(tool_use.input)})")
                result = await self.tool_executor.execute(tool_use)
                result_blocks.append(result)
                status = "ERROR" if result.is_error else "OK"
                content_preview = str(result.content)[:60]
                print(f"    Result [{status}]: {content_preview}...")

            # Step 4: Add tool results as user message
            tool_result_msg = make_user_message(*result_blocks)
            self.conversation.append(tool_result_msg)

            # Step 5: Check context size (simplified)
            total_chars = sum(
                len(str(block)) for msg in self.conversation
                for block in msg.content
            )
            print(f"  [Turn {turn_count}] Context size: ~{total_chars} chars")

        return final_text


# Run the query loop
api = SimulatedAPIClient()
executor = SimpleToolExecutor(api)
loop = QueryLoop(api, executor)

print("=== Running Query Loop ===")
print()
result = asyncio.run(loop.run("Read main.py and summarize it"))
print()
print("=== Final Result ===")
print(result)
print()
print(f"Total API calls: {api.call_count}")
print(f"Conversation messages: {len(loop.conversation)}")
`);

md(`## 5. Streaming simulation

The real Claude Code uses Server-Sent Events (SSE) for streaming. Here's how
it works conceptually:

### SSE Event Types

| Event | Purpose |
|-------|---------|
| ${BT}message_start${BT} | Begin new message, contains role + usage |
| ${BT}content_block_start${BT} | Begin new content block (text/tool_use/thinking) |
| ${BT}content_block_delta${BT} | Partial content (text delta, input JSON delta) |
| ${BT}content_block_stop${BT} | End current content block |
| ${BT}message_delta${BT} | Final usage + stop_reason |
| ${BT}message_stop${BT} | End of message |

### Tool use accumulation during streaming

Tool use inputs arrive incrementally as JSON deltas. The client accumulates
them into a complete JSON object:

${BT3}python
# Streaming accumulation of tool_use input
# Deltas arrive character by character:
#   delta 1: '{"file'
#   delta 2: '_path'
#   delta 3: '":"/sr'
#   delta 4: 'c/mai'
#   delta 5: 'n.py"}'
# Accumulated: '{"file_path":"/src/main.py"}'
${BT3}

> **Source:** ${BT}services/api/claude.ts${BT} handles SSE parsing and tool_use accumulation.
`);

code(`# === Streaming Simulation ===
import time


class StreamingSimulator:
    """
    Simulates how the real API streams responses.

    In the real implementation (services/api/claude.ts), responses
    arrive as SSE events. The client parses them and accumulates:
    - Text content: concatenated text deltas
    - Tool use: accumulated JSON input deltas
    - Thinking: accumulated thinking text
    """

    def __init__(self, response_blocks: list[ContentBlock]):
        self.blocks = response_blocks

    async def stream(self) -> AsyncGenerator[dict, None]:
        """
        Simulate streaming by yielding events.

        Real SSE events are:
          message_start -> content_block_start -> content_block_delta(s)
          -> content_block_stop -> message_delta -> message_stop
        """
        # message_start
        yield {
            "type": "message_start",
            "message": {"role": "assistant", "usage": {"input_tokens": 100}}
        }

        for i, block in enumerate(self.blocks):
            # content_block_start
            yield {"type": "content_block_start", "index": i, "block": block}

            if isinstance(block, TextBlock):
                # Stream text character by character (simulated)
                words = block.text.split(" ")
                for j, word in enumerate(words):
                    chunk = word if j == 0 else " " + word
                    yield {
                        "type": "content_block_delta",
                        "index": i,
                        "delta": {"type": "text_delta", "text": chunk}
                    }
                    await asyncio.sleep(0.01)  # simulate network latency

            elif isinstance(block, ToolUseBlock):
                # Stream tool input JSON incrementally
                input_json = json.dumps(block.input)
                chunk_size = max(1, len(input_json) // 5)
                for start in range(0, len(input_json), chunk_size):
                    chunk = input_json[start:start + chunk_size]
                    yield {
                        "type": "content_block_delta",
                        "index": i,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": chunk
                        }
                    }
                    await asyncio.sleep(0.01)

            # content_block_stop
            yield {"type": "content_block_stop", "index": i}

        # message_delta + message_stop
        yield {
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use" if any(isinstance(b, ToolUseBlock) for b in self.blocks) else "end_turn"},
            "usage": {"output_tokens": 50}
        }
        yield {"type": "message_stop"}


# Demonstrate streaming
async def demo_streaming():
    blocks = [
        TextBlock(text="I will read that file for you now."),
        ToolUseBlock(id="toolu_stream_001", name="Read", input={"file_path": "/src/main.py"}),
    ]

    simulator = StreamingSimulator(blocks)

    accumulated_text = ""
    accumulated_json = ""
    tool_name = ""
    stop_reason = None

    print("=== Streaming Events ===")
    async for event in simulator.stream():
        if event["type"] == "content_block_start":
            block = event["block"]
            if isinstance(block, TextBlock):
                print(f"  [content_block_start] text block")
            elif isinstance(block, ToolUseBlock):
                tool_name = block.name
                print(f"  [content_block_start] tool_use block: {block.name}")

        elif event["type"] == "content_block_delta":
            delta = event["delta"]
            if delta["type"] == "text_delta":
                accumulated_text += delta["text"]
            elif delta["type"] == "input_json_delta":
                accumulated_json += delta["partial_json"]

        elif event["type"] == "content_block_stop":
            if accumulated_text:
                print(f"  [text accumulated] '{accumulated_text[:50]}...'")
                accumulated_text = ""
            if accumulated_json:
                print(f"  [tool JSON accumulated] {accumulated_json}")
                accumulated_json = ""

        elif event["type"] == "message_delta":
            stop_reason = event["delta"]["stop_reason"]
            print(f"  [message_delta] stop_reason={stop_reason}")

        elif event["type"] == "message_stop":
            print(f"  [message_stop] Stream complete")

    print(f"\\nFinal stop_reason: {stop_reason}")

asyncio.run(demo_streaming())
`);

md(`## 6. Context compaction

When the conversation grows too long, it exceeds the model's context window.
Claude Code handles this with **auto-compaction** -- summarizing old messages
to free up space.

> **Source:** ${BT}services/compact/autoCompact.ts${BT}, ${BT}services/compact/compact.ts${BT}

### How compaction works

${BT3}mermaid
flowchart LR
    A["Messages growing<br/>(50k+ tokens)"] --> B{"Token count ><br/>threshold?"}
    B -- No --> C["Continue normally"]
    B -- Yes --> D["Call API to summarize<br/>old messages"]
    D --> E["Replace old messages<br/>with summary"]
    E --> F["Compact boundary<br/>message"]
    F --> G["Continue with<br/>compact context"]
${BT3}

### Compaction details from the source

In ${BT}query.ts${BT} (L454-L543), the compaction flow:
1. ${BT}calculateTokenWarningState()${BT} checks if context exceeds threshold
2. ${BT}deps.autocompact()${BT} sends old messages to a smaller model for summarization
3. ${BT}buildPostCompactMessages()${BT} replaces old messages with summary + boundary marker
4. A ${BT}compact_boundary${BT} system message is yielded for UI/transcript tracking
5. The loop continues with the compacted message list
`);

code(`# === Context Compaction Simulation ===

class ContextCompactor:
    """
    Simulates the context compaction process.
    Source: services/compact/autoCompact.ts, services/compact/compact.ts

    The real implementation:
    1. Calculates token count using tiktoken-style estimation
    2. If over threshold, sends old messages to a smaller model
    3. Model generates a summary preserving key context
    4. Old messages are replaced with summary + compact_boundary
    """

    def __init__(self, max_chars: int = 500):
        """
        Args:
            max_chars: Maximum context size in characters (simplified).
                       Real threshold is ~180k tokens.
        """
        self.max_chars = max_chars

    def estimate_size(self, messages: list[Message]) -> int:
        """Estimate total message size (simplified token counting)."""
        total = 0
        for msg in messages:
            for block in msg.content:
                if isinstance(block, TextBlock):
                    total += len(block.text)
                elif isinstance(block, ToolUseBlock):
                    total += len(json.dumps(block.input))
                elif isinstance(block, ToolResultBlock):
                    total += len(str(block.content))
        return total

    def compact(self, messages: list[Message]) -> tuple[list[Message], str]:
        """
        Compact messages by summarizing old ones.

        Returns (compacted_messages, summary_text).
        Real implementation calls the API to generate the summary.
        """
        total = self.estimate_size(messages)
        if total <= self.max_chars:
            return messages, ""  # No compaction needed

        print(f"  Compacting: {total} chars -> threshold {self.max_chars}")

        # Find a good split point: keep recent messages, summarize old ones
        # The real implementation is smarter about preserving tool_use/result pairs
        keep_recent = 2  # Keep last 2 message exchanges
        if len(messages) <= keep_recent:
            return messages, ""

        old_messages = messages[:-keep_recent]
        recent_messages = messages[-keep_recent:]

        # Generate summary (real implementation calls API)
        summary_parts = []
        for msg in old_messages:
            for block in msg.content:
                if isinstance(block, TextBlock):
                    summary_parts.append(block.text[:100])
                elif isinstance(block, ToolUseBlock):
                    summary_parts.append(f"[Called {block.name} tool]")

        summary = (
            "## Conversation Summary\\n\\n"
            "The user asked about code analysis. "
            + " ".join(summary_parts[:3])
            + "\\n\\n---\\n"
        )

        # Build compacted messages: summary + boundary + recent
        compacted = [
            make_user_message(TextBlock(text=summary)),
        ]

        # In the real implementation, a compact_boundary system message is inserted
        print(f"  Summarized {len(old_messages)} messages into {len(summary)} char summary")
        print(f"  Kept {len(recent_messages)} recent messages")

        return compacted + recent_messages, summary


# Demonstrate compaction
print("=== Context Compaction Demo ===")
print()

# Build a conversation that's "too long"
long_conversation: list[Message] = []
for i in range(10):
    long_conversation.append(make_text_user_message(
        f"This is message number {i} with some content about topic {i}. " * 5
    ))
    long_conversation.append(make_assistant_message(TextBlock(
        text=f"Response to message {i}. " * 5
    )))

compactor = ContextCompactor(max_chars=500)
print(f"Before compaction: {len(long_conversation)} messages, "
      f"{compactor.estimate_size(long_conversation)} chars")
print()

compacted, summary = compactor.compact(long_conversation)
print()
print(f"After compaction: {len(compacted)} messages, "
      f"{compactor.estimate_size(compacted)} chars")
`);

md(`## 7. Complete QueryEngine class

Now we combine everything into a complete ${BT}QueryEngine${BT} class that mirrors
the real ${BT}QueryEngine.ts${BT} (L184-L1178).

The real ${BT}QueryEngine${BT} class:
- Manages conversation state (${BT}mutableMessages${BT})
- Handles system prompt construction
- Tracks usage and costs
- Supports abort via ${BT}AbortController${BT}
- Processes slash commands before entering the query loop
- Yields typed SDK messages for consumers

> **Source:** ${BT}QueryEngine.ts${BT} L184-L1178
`);

code(`# === Complete QueryEngine Implementation ===

@dataclass
class QueryConfig:
    """Configuration for the query engine. Source: QueryEngine.ts L130-173"""
    system_prompt: str = "You are Claude, a helpful coding assistant."
    max_turns: int = 10
    max_context_chars: int = 5000
    verbose: bool = True


class QueryEngine:
    """
    Complete query engine. Source: QueryEngine.ts L184-L1178

    This is the main orchestrator that:
    1. Accepts user messages
    2. Manages conversation history
    3. Runs the agentic loop (API calls + tool execution)
    4. Handles context compaction
    5. Tracks usage statistics
    """

    def __init__(
        self,
        config: QueryConfig | None = None,
        api_client: SimulatedAPIClient | None = None,
        tool_executor: SimpleToolExecutor | None = None,
    ):
        self.config = config or QueryConfig()
        self.api_client = api_client or SimulatedAPIClient()
        self.tool_executor = tool_executor or SimpleToolExecutor(self.api_client)
        self.compactor = ContextCompactor(max_chars=self.config.max_context_chars)

        # State: mirrors QueryEngine.ts mutableMessages
        self.messages: list[Message] = []
        self.turn_count = 0
        self.total_api_calls = 0

    def submit(self, user_text: str) -> str:
        """
        Submit a user message and run the agentic loop.
        Source: QueryEngine.ts submitMessage() L209

        The real implementation is an async generator that yields
        SDKMessage objects for the caller to process incrementally.
        We simplify to a synchronous function returning the final text.
        """
        # Add user message to history
        self.messages.append(make_text_user_message(user_text))

        final_text = ""

        for turn in range(self.config.max_turns):
            self.turn_count += 1

            if self.config.verbose:
                print(f"  [Turn {self.turn_count}] "
                      f"Messages: {len(self.messages)}, "
                      f"Context: {self.compactor.estimate_size(self.messages)} chars")

            # --- Auto-compaction check ---
            # Source: query.ts L454-L543
            compacted_msgs, summary = self.compactor.compact(self.messages)
            if summary:
                self.messages = compacted_msgs
                if self.config.verbose:
                    print(f"  [Compaction] Context compacted")

            # --- Call API (simulated) ---
            self.total_api_calls += 1
            assistant_blocks: list[ContentBlock] = []
            tool_use_blocks: list[ToolUseBlock] = []

            loop = asyncio.get_event_loop()
            async def call_api():
                nonlocal assistant_blocks, tool_use_blocks
                async for event in self.api_client.create_message(
                    messages=self.messages,
                    system_prompt=self.config.system_prompt,
                ):
                    block = event["block"]
                    assistant_blocks.append(block)
                    if isinstance(block, ToolUseBlock):
                        tool_use_blocks.append(block)

            loop.run_until_complete(call_api())

            # Add assistant response to history
            self.messages.append(make_assistant_message(*assistant_blocks))

            # --- Check for tool use ---
            if not tool_use_blocks:
                # No tools -- extract text and return
                for block in assistant_blocks:
                    if isinstance(block, TextBlock):
                        final_text += block.text
                break

            # --- Execute tools ---
            result_blocks: list[ToolResultBlock] = []
            for tool_use in tool_use_blocks:
                if self.config.verbose:
                    print(f"    Tool: {tool_use.name}({json.dumps(tool_use.input)})")
                result = loop.run_until_complete(self.tool_executor.execute(tool_use))
                result_blocks.append(result)

            # Add tool results as user message
            self.messages.append(make_user_message(*result_blocks))

        return final_text

    def get_stats(self) -> dict:
        """Get query engine statistics."""
        return {
            "total_turns": self.turn_count,
            "total_api_calls": self.total_api_calls,
            "message_count": len(self.messages),
            "context_size": self.compactor.estimate_size(self.messages),
        }


# --- Run the complete engine ---
print("=" * 60)
print("Complete QueryEngine Demo")
print("=" * 60)
print()

engine = QueryEngine(
    config=QueryConfig(verbose=True, max_context_chars=2000),
)

result = engine.submit("Read main.py and summarize it")

print()
print("--- Result ---")
print(result)
print()
print("--- Stats ---")
stats = engine.get_stats()
for k, v in stats.items():
    print(f"  {k}: {v}")
`);

md(`## 8. Source mapping table

| Our Python Implementation | Original TypeScript Source |
|---------------------------|--------------------------|
| ${BT}Message${BT}, ${BT}TextBlock${BT}, ${BT}ToolUseBlock${BT}, ${BT}ToolResultBlock${BT} | SDK types + ${BT}utils/messages.ts${BT} |
| ${BT}QueryLoop${BT} | ${BT}query.ts${BT} L219-L1729 (${BT}query()${BT} generator) |
| ${BT}StreamingSimulator${BT} | ${BT}services/api/claude.ts${BT} (SSE parsing) |
| ${BT}ContextCompactor${BT} | ${BT}services/compact/autoCompact.ts${BT} + ${BT}compact.ts${BT} |
| ${BT}SimpleToolExecutor${BT} | ${BT}services/tools/toolOrchestration.ts${BT} (${BT}runTools${BT}) |
| ${BT}QueryEngine${BT} | ${BT}QueryEngine.ts${BT} L184-L1178 |
| ${BT}QueryConfig${BT} | ${BT}QueryEngine.ts${BT} L130-173 (${BT}QueryEngineConfig${BT}) |
| ${BT}SimulatedAPIClient${BT} | ${BT}services/api/claude.ts${BT} (${BT}queryModelWithStreaming${BT}) |

### Key concepts covered

1. **Agentic loop**: The core ${BT}while(true)${BT} pattern that loops until text response
2. **Message protocol**: How user/assistant/tool messages flow through the system
3. **Tool orchestration**: tool_use -> execute -> tool_result -> continue
4. **Streaming**: SSE events, content delta accumulation for text and JSON
5. **Context compaction**: Summarizing old messages when context fills up
6. **QueryEngine**: The orchestrator class that ties it all together

---

## 9. Architecture overview

${BT3}mermaid
classDiagram
    class QueryEngine {
        -messages: List~Message~
        -config: QueryConfig
        -compactor: ContextCompactor
        +submit(text) str
        +get_stats() dict
    }

    class QueryLoop {
        +run(text) str
        -call_api()
        -execute_tools()
    }

    class SimulatedAPIClient {
        +create_message() AsyncGenerator
    }

    class SimpleToolExecutor {
        +execute(tool_use) ToolResultBlock
    }

    class ContextCompactor {
        +estimate_size() int
        +compact(messages) tuple
    }

    class Message {
        +role: str
        +content: List~Block~
    }

    class ToolUseBlock {
        +id: str
        +name: str
        +input: dict
    }

    class ToolResultBlock {
        +tool_use_id: str
        +content: str
        +is_error: bool
    }

    QueryEngine --> QueryLoop
    QueryEngine --> ContextCompactor
    QueryLoop --> SimulatedAPIClient
    QueryLoop --> SimpleToolExecutor
    QueryLoop --> Message
    Message o-- ToolUseBlock
    Message o-- ToolResultBlock
${BT3}

---

<- [Previous: Bash Tool & Permission System](04-bash-permissions.ipynb) | [Next: Command System & Skill Architecture ->](06-command-skills.ipynb)
`);

// Lint
cells.forEach((cell, i) => {
  if (cell.cell_type === 'code' && cell.source.join('').includes('```mermaid')) {
    console.warn('WARNING: Cell ' + i + ' is a code cell but contains mermaid diagram');
  }
});

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.10.0' }
  },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('05-query-engine.ipynb', output);
console.log('Cells: ' + cells.length + '  Size: ' + output.length + ' bytes');
