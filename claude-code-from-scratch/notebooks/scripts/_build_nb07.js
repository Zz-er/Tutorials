const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 7: MCP 协议与插件系统

**本章你将学到：**
- Model Context Protocol (MCP) 的核心概念
- MCP 客户端的简化实现
- 插件系统的生命周期管理
- 扩展机制的设计模式

> **Source:** ${BT}services/mcp/${BT}, ${BT}plugins/${BT}

---

## 1. 痛点：核心工具无法覆盖所有需求

Claude Code 内置了 40+ 工具，但不可能覆盖所有场景：
- 访问 Jira/Linear 项目管理
- 调用自定义 API
- 使用特定数据库
- 操作特殊文件格式

**MCP 协议**和**插件系统**解决了这个扩展性问题。

---

## 2. MCP 协议架构

${BT3}mermaid
flowchart TB
    subgraph "Claude Code (MCP Client)"
        CLIENT["MCP Client"]
        TOOL["动态工具<br/>mcp__server__tool"]
        RESOURCE["资源访问<br/>ReadMcpResource"]
    end

    subgraph "MCP Server (外部)"
        S1["Git Server"]
        S2["Database Server"]
        S3["Custom API Server"]
    end

    CLIENT -->|"stdio/SSE/WS"| S1
    CLIENT -->|"stdio/SSE/WS"| S2
    CLIENT -->|"stdio/SSE/WS"| S3
    S1 -->|"tools + resources"| TOOL
    TOOL --> CLIENT
${BT3}

### MCP 核心概念

| 概念 | 说明 |
|------|------|
| **Transport** | 通信协议：stdio、SSE、HTTP、WebSocket |
| **Tool** | 服务器提供的可调用工具 |
| **Resource** | 服务器提供的可读资源（文件、数据） |
| **Prompt** | 服务器提供的提示模板 |
| **Capability** | 服务器声明的支持能力 |

> **Source:** ${BT}services/mcp/client.ts${BT} — 122KB 的完整实现
`);

code(`# === MCP 协议简化实现 ===
import json
from abc import ABC, abstractmethod


@dataclass
class MCPToolDefinition:
    """MCP 工具定义"""
    name: str
    description: str
    input_schema: dict


@dataclass
class MCPResource:
    """MCP 资源"""
    uri: str
    name: str
    description: str
    mime_type: str = "text/plain"


class MCPTransport(ABC):
    """
    MCP 传输层抽象。Source: services/mcp/client.ts

    支持多种传输方式：
    - StdioTransport: 通过 stdin/stdout 通信
    - SSETransport: 通过 Server-Sent Events
    - HTTPTransport: 通过 HTTP POST
    - WebSocketTransport: 通过 WebSocket
    """
    @abstractmethod
    async def send(self, message: dict) -> dict: ...

    @abstractmethod
    async def close(self): ...


class MockTransport(MCPTransport):
    """模拟传输层（用于测试）"""
    def __init__(self, tools: list[MCPToolDefinition] = None, resources: list[MCPResource] = None):
        self._tools = tools or []
        self._resources = resources or []
        self._call_log = []

    async def send(self, message: dict) -> dict:
        self._call_log.append(message)
        method = message.get("method", "")

        if method == "tools/list":
            return {
                "tools": [
                    {"name": t.name, "description": t.description, "inputSchema": t.input_schema}
                    for t in self._tools
                ]
            }
        elif method == "resources/list":
            return {
                "resources": [
                    {"uri": r.uri, "name": r.name, "description": r.description, "mimeType": r.mime_type}
                    for r in self._resources
                ]
            }
        elif method == "tools/call":
            return {"content": [{"type": "text", "text": f"Result of {message.get('params', {}).get('name')}: OK"}]}
        return {}

    async def close(self):
        pass


class MCPClient:
    """
    MCP 客户端。Source: services/mcp/client.ts

    核心功能：
    1. 连接到 MCP 服务器
    2. 发现可用工具和资源
    3. 调用工具
    4. 读取资源
    """

    def __init__(self, server_name: str, transport: MCPTransport):
        self.server_name = server_name
        self.transport = transport
        self._tools: list[MCPToolDefinition] = []
        self._resources: list[MCPResource] = []
        self._connected = False

    async def connect(self):
        """
        连接并初始化。
        Source: services/mcp/client.ts initialize()
        """
        # 发现工具
        response = await self.transport.send({"method": "tools/list"})
        for tool_data in response.get("tools", []):
            self._tools.append(MCPToolDefinition(
                name=tool_data["name"],
                description=tool_data.get("description", ""),
                input_schema=tool_data.get("inputSchema", {})
            ))

        # 发现资源
        response = await self.transport.send({"method": "resources/list"})
        for res_data in response.get("resources", []):
            self._resources.append(MCPResource(
                uri=res_data["uri"],
                name=res_data["name"],
                description=res_data.get("description", ""),
                mime_type=res_data.get("mimeType", "text/plain")
            ))

        self._connected = True

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """调用 MCP 工具"""
        if not self._connected:
            raise RuntimeError("Not connected")

        return await self.transport.send({
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments}
        })

    def get_tools(self) -> list[MCPToolDefinition]:
        return self._tools

    def get_resources(self) -> list[MCPResource]:
        return self._resources

    async def close(self):
        await self.transport.close()
        self._connected = False


# 测试 MCP 客户端
mock_tools = [
    MCPToolDefinition("query_db", "Query the database", {
        "type": "object",
        "properties": {"sql": {"type": "string"}},
        "required": ["sql"]
    }),
    MCPToolDefinition("list_tables", "List all tables", {"type": "object", "properties": {}}),
]

mock_resources = [
    MCPResource("db://schema", "Database Schema", "The current database schema"),
]

transport = MockTransport(tools=mock_tools, resources=mock_resources)
client = MCPClient("database-server", transport)

asyncio.run(client.connect())

print("=== MCP Client 测试 ===")
print(f"Server: {client.server_name}")
print(f"Connected: {client._connected}")
print()
print("Discovered tools:")
for t in client.get_tools():
    print(f"  {t.name}: {t.description}")
    print(f"    schema: {json.dumps(t.input_schema)}")

print()
print("Discovered resources:")
for r in client.get_resources():
    print(f"  {r.uri}: {r.description}")

# 调用工具
result = asyncio.run(client.call_tool("list_tables", {}))
print(f"\\nTool call result: {result}")
`);

md(`## 3. 插件系统

插件系统建立在 MCP 之上，提供了更丰富的扩展能力：

${BT3}mermaid
flowchart TB
    subgraph "Plugin Lifecycle"
        INSTALL["安装"] --> LOAD["加载"]
        LOAD --> ENABLE["启用"]
        ENABLE --> RUN["运行"]
        RUN --> DISABLE["禁用"]
        DISABLE --> UNINSTALL["卸载"]
    end

    subgraph "Plugin Capabilities"
        PTOOL["提供工具"]
        PHOOK["提供 Hooks"]
        PMCP["提供 MCP Server"]
        PSKILL["提供 Skills"]
    end

    LOAD --> PTOOL
    LOAD --> PHOOK
    LOAD --> PMCP
    LOAD --> PSKILL
${BT3}

> **Source:** ${BT}plugins/${BT}, ${BT}services/plugins/${BT}
`);

code(`# === 插件系统实现 ===


@dataclass
class PluginManifest:
    """
    插件清单。Source: services/plugins/pluginOperations.ts

    定义插件的基本信息和能力。
    """
    name: str
    version: str
    description: str
    tools: list[dict] = field(default_factory=list)
    hooks: list[dict] = field(default_factory=list)
    mcp_servers: list[dict] = field(default_factory=list)
    skills: list[dict] = field(default_factory=list)


class Plugin:
    """插件实例"""
    def __init__(self, manifest: PluginManifest, source: str = "marketplace"):
        self.manifest = manifest
        self.source = source
        self.enabled = True

    @property
    def name(self) -> str:
        return self.manifest.name

    def disable(self):
        self.enabled = False

    def enable(self):
        self.enabled = True


class PluginManager:
    """
    插件管理器。Source: services/plugins/

    职责：
    1. 安装/卸载插件
    2. 启用/禁用插件
    3. 解析插件依赖
    4. 提供插件工具和 MCP 服务器
    """

    def __init__(self):
        self._plugins: dict[str, Plugin] = {}
        self._install_dir: Path = Path(".claude/plugins")

    def install(self, manifest: PluginManifest, source: str = "marketplace") -> Plugin:
        """安装插件"""
        plugin = Plugin(manifest, source)
        self._plugins[manifest.name] = plugin
        return plugin

    def uninstall(self, name: str) -> bool:
        """卸载插件"""
        if name in self._plugins:
            del self._plugins[name]
            return True
        return False

    def get(self, name: str) -> Plugin | None:
        return self._plugins.get(name)

    def get_enabled(self) -> list[Plugin]:
        return [p for p in self._plugins.values() if p.enabled]

    def get_all_tools(self) -> list[dict]:
        """获取所有插件提供的工具"""
        tools = []
        for plugin in self.get_enabled():
            tools.extend(plugin.manifest.tools)
        return tools

    def get_all_mcp_servers(self) -> list[dict]:
        """获取所有插件提供的 MCP 服务器"""
        servers = []
        for plugin in self.get_enabled():
            servers.extend(plugin.manifest.mcp_servers)
        return servers


# 测试插件系统
manager = PluginManager()

# 安装一个 Git 插件
git_plugin = manager.install(PluginManifest(
    name="git-extended",
    version="1.0.0",
    description="Extended Git operations",
    tools=[
        {"name": "git_blame", "description": "Git blame for a file"},
        {"name": "git_log_graph", "description": "Visual git log graph"},
    ],
    mcp_servers=[
        {"name": "git-server", "command": "git-mcp-server"}
    ]
))

# 安装一个 Jira 插件
jira_plugin = manager.install(PluginManifest(
    name="jira-integration",
    version="2.1.0",
    description="Jira project management",
    tools=[
        {"name": "create_ticket", "description": "Create a Jira ticket"},
        {"name": "search_tickets", "description": "Search Jira tickets"},
    ]
))

print("=== 插件系统测试 ===")
print(f"Installed plugins: {[p.name for p in manager._plugins.values()]}")
print(f"Enabled plugins: {[p.name for p in manager.get_enabled()]}")
print(f"Plugin tools: {[t['name'] for t in manager.get_all_tools()]}")
print(f"MCP servers: {[s['name'] for s in manager.get_all_mcp_servers()]}")

# 禁用插件
manager.get("jira-integration").disable()
print(f"\\nAfter disabling jira: {[p.name for p in manager.get_enabled()]}")
print(f"Remaining tools: {[t['name'] for t in manager.get_all_tools()]}")
`);

md(`## 4. 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}MCPTransport${BT} | ${BT}services/mcp/client.ts${BT} transport 抽象 |
| ${BT}MCPClient${BT} | ${BT}services/mcp/client.ts${BT} (122KB) |
| ${BT}MCPToolDefinition${BT} | MCP SDK types |
| ${BT}PluginManifest${BT} | ${BT}services/plugins/pluginOperations.ts${BT} |
| ${BT}PluginManager${BT} | ${BT}services/plugins/${BT} 多个文件 |

---

← [上一章：命令与技能](06-command-skills.ipynb) | [下一章：状态管理 →](08-state-management-ui.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('07-mcp-plugins.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
