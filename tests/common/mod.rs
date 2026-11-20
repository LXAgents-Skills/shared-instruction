//! The shared harness for the integration suites: the binaries, a running server, a raw HTTP
//! client, and a stdio MCP client.
//!
//! Every server is the real binary started as a child process, because that is what a client
//! runs, and because the things that go wrong on a socket — the route table, the guards, the
//! framing, what a signal does — do not reproduce in-process. Every server binds loopback only,
//! so the suite never opens a port on every interface of the machine that runs it.

#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// The main binary: stdio, or HTTP on `MCP_TRANSPORT=http`.
pub const MAIN: &str = env!("CARGO_BIN_EXE_lxagents-shared-instruction");
/// The HTTP binary.
pub const HTTP: &str = env!("CARGO_BIN_EXE_lxagents-shared-instruction-http");

/// The token every server here runs with unless a test says otherwise. Long enough to pass the
/// length check, and obviously not a real secret.
pub const TEST_TOKEN: &str = "test-token-0123456789abcdef0123456789abcdef";

/// The line every HTTP server writes once it is listening.
pub const READY: &str = "serving Skill MCP over http";

/// How long to wait for a server's startup line.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// The published set, as the server resolves it.
pub fn content_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("content")
}

/// How many tools a correct surface has: one per markdown file. Asserted to be a real set, so a
/// `content/` that failed to load cannot make every count comparison pass at zero.
pub fn expected_tools() -> usize {
    let count = lxagents_shared_instruction::instructions::markdown_files(&content_dir())
        .unwrap()
        .len();
    assert!(count > 20, "expected a real set, found {count} files");
    count
}

/// A free loopback port.
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Everything a child wrote on one stream, collected as it arrives.
#[derive(Clone, Default)]
pub struct Captured(Arc<Mutex<String>>);

impl Captured {
    fn follow(&self, stream: impl Read + Send + 'static) {
        let sink = self.0.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                sink.lock().unwrap().push_str(&line);
                line.clear();
            }
        });
    }

    pub fn text(&self) -> String {
        self.0.lock().unwrap().clone()
    }
}

/// A running HTTP server. Killed when dropped, so a failed assertion cannot leak one.
pub struct Server {
    pub child: Child,
    pub port: u16,
    pub stdout: Captured,
    pub stderr: Captured,
}

impl Server {
    /// Start `binary` with the test token, loopback, a free port, and `env` on top, and wait for
    /// its startup line. Panics with the server's output when it never comes up.
    pub fn start(binary: &str, env: &[(&str, &str)]) -> Server {
        let (mut child, port, stdout, stderr) = spawn(binary, env);
        let deadline = Instant::now() + READY_TIMEOUT;
        while !stderr.text().contains(READY) {
            if let Some(status) = child.try_wait().unwrap() {
                panic!(
                    "the server exited before it came up ({status}):\n{}",
                    stderr.text()
                );
            }
            assert!(
                Instant::now() < deadline,
                "no startup line within {READY_TIMEOUT:?}:\n{}",
                stderr.text()
            );
            thread::sleep(Duration::from_millis(20));
        }
        Server {
            child,
            port,
            stdout,
            stderr,
        }
    }

    /// The HTTP binary with the default environment.
    pub fn http() -> Server {
        Server::start(HTTP, &[])
    }

    /// Everything on stderr so far.
    pub fn output(&self) -> String {
        self.stderr.text()
    }

    /// How often `needle` appears on stderr.
    pub fn count(&self, needle: &str) -> usize {
        self.output().matches(needle).count()
    }

    /// Wait until `needle` is on stderr.
    pub fn wait_for(&self, needle: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if self.output().contains(needle) {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    }

    /// Send `signal` (a `kill` name, such as `INT`) to the process.
    pub fn signal(&self, signal: &str) {
        let status = Command::new("kill")
            .arg(format!("-{signal}"))
            .arg(self.child.id().to_string())
            .status()
            .unwrap();
        assert!(status.success());
    }

    /// Wait for the process to exit, up to `limit`.
    pub fn wait_exit(&mut self, limit: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + limit;
        while Instant::now() < deadline {
            if let Some(status) = self.child.try_wait().unwrap() {
                return Some(status);
            }
            thread::sleep(Duration::from_millis(20));
        }
        None
    }

    /// A request to this server.
    pub fn request(&self, method: &str, path: &str) -> Req {
        Req::new(self.port, method, path)
    }

    /// An authorised MCP request, its JSON-RPC result or error parsed.
    pub fn rpc(&self, method: &str, params: Value) -> Value {
        let response = self
            .request("POST", "/mcp")
            .mcp()
            .bearer(TEST_TOKEN)
            .json(&json!({
                "jsonrpc": "2.0", "id": 1, "method": method, "params": params
            }))
            .send();
        assert_eq!(response.status, 200, "{method}: {}", response.body);
        response.json()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn(binary: &str, env: &[(&str, &str)]) -> (Child, u16, Captured, Captured) {
    let port = free_port();
    let mut command = Command::new(binary);
    command
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("MCP_AUTH_TOKEN", TEST_TOKEN)
        .env_remove("MCP_ALLOWED_HOSTS")
        .env_remove("MCP_CLUSTER_WORKERS")
        .env_remove("MCP_TRANSPORT")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in env {
        command.env(key, value);
    }
    let mut child = command.spawn().unwrap();
    let (stdout, stderr) = (Captured::default(), Captured::default());
    stdout.follow(child.stdout.take().unwrap());
    stderr.follow(child.stderr.take().unwrap());
    (child, port, stdout, stderr)
}

/// Run `binary` expecting it to stop on its own, and return its exit code and output.
pub fn run_to_exit(binary: &str, env: &[(&str, &str)]) -> (Option<i32>, String) {
    let (mut child, _, stdout, stderr) = spawn(binary, env);
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            thread::sleep(Duration::from_millis(50));
            return (status.code(), format!("{}{}", stdout.text(), stderr.text()));
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            return (None, format!("still running\n{}", stderr.text()));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

/// One HTTP/1.1 request, written by hand so a test controls every header, `Host` included.
pub struct Req {
    port: u16,
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Req {
    pub fn new(port: u16, method: &str, path: &str) -> Req {
        Req {
            port,
            method: method.into(),
            path: path.into(),
            headers: vec![("Host".into(), format!("127.0.0.1:{port}"))],
            body: Vec::new(),
        }
    }

    /// Set a header, replacing one of the same name.
    pub fn header(mut self, name: &str, value: &str) -> Req {
        self.headers
            .retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn host(self, host: &str) -> Req {
        self.header("Host", host)
    }

    pub fn bearer(self, token: &str) -> Req {
        self.header("Authorization", &format!("Bearer {token}"))
    }

    /// The headers the Streamable HTTP transport insists on.
    pub fn mcp(self) -> Req {
        self.header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
    }

    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Req {
        self.body = body.into();
        self
    }

    pub fn json(self, value: &Value) -> Req {
        self.body(value.to_string())
    }

    /// A `tools/list` with the transport's headers.
    pub fn list_tools(self) -> Req {
        self.mcp()
            .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
    }

    pub fn send(self) -> Resp {
        self.try_send().expect("the request failed")
    }

    pub fn try_send(self) -> std::io::Result<Resp> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port))?;
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        let mut head = format!("{} {} HTTP/1.1\r\n", self.method, self.path);
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str(&format!(
            "Content-Length: {}\r\nConnection: close\r\n\r\n",
            self.body.len()
        ));
        stream.write_all(head.as_bytes())?;
        // A server may refuse before reading a large body; what it answered is what matters.
        let _ = stream.write_all(&self.body);
        let mut raw = Vec::new();
        let _ = stream.read_to_end(&mut raw);
        Resp::parse(&raw).ok_or_else(|| std::io::Error::other("no HTTP response"))
    }
}

/// A parsed response.
#[derive(Debug)]
pub struct Resp {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl Resp {
    fn parse(raw: &[u8]) -> Option<Resp> {
        let text = String::from_utf8_lossy(raw);
        let (head, body) = text.split_once("\r\n\r\n")?;
        let mut lines = head.split("\r\n");
        let status = lines.next()?.split(' ').nth(1)?.parse().ok()?;
        let headers: HashMap<String, String> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_string()))
            .collect();
        let body = if headers
            .get("transfer-encoding")
            .is_some_and(|value| value.contains("chunked"))
        {
            dechunk(body)
        } else {
            body.to_string()
        };
        Some(Resp {
            status,
            headers,
            body,
        })
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_lowercase()).map(String::as_str)
    }

    /// The body as JSON; an SSE body's last `data:` line.
    pub fn json(&self) -> Value {
        let text = if self
            .header("content-type")
            .is_some_and(|value| value.starts_with("text/event-stream"))
        {
            self.body
                .lines()
                .rev()
                .find_map(|line| line.strip_prefix("data:"))
                .unwrap_or("")
                .trim()
                .to_string()
        } else {
            self.body.clone()
        };
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("not JSON ({error}): {}", self.body))
    }
}

fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some((size, after)) = rest.split_once("\r\n") {
        let Ok(size) = usize::from_str_radix(size.trim(), 16) else {
            break;
        };
        if size == 0 || after.len() < size {
            break;
        }
        out.push_str(&after[..size]);
        rest = after[size..].trim_start_matches("\r\n");
    }
    out
}

/// An MCP client over a spawned binary's stdin and stdout.
pub struct StdioClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    pub stderr: Captured,
    next_id: u64,
    pub instructions: String,
}

impl StdioClient {
    /// Spawn `binary` with `env` and complete the `initialize` handshake.
    pub fn connect(binary: &str, env: &[(&str, &str)]) -> StdioClient {
        let mut command = Command::new(binary);
        command
            .env_remove("MCP_TRANSPORT")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in env {
            command.env(key, value);
        }
        let mut child = command.spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let stderr = Captured::default();
        stderr.follow(child.stderr.take().unwrap());
        let mut client = StdioClient {
            child,
            stdin,
            stdout,
            stderr,
            next_id: 0,
            instructions: String::new(),
        };

        let init = client.call("initialize", json!({
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "stdio-test", "version": "0.0.0" }
        }));
        client.instructions = init["result"]["instructions"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        client.notify("notifications/initialized");
        client
    }

    /// The main binary over stdio, with no token.
    pub fn main() -> StdioClient {
        StdioClient::connect(MAIN, &[("MCP_AUTH_TOKEN", "")])
    }

    fn notify(&mut self, method: &str) {
        writeln!(
            self.stdin,
            "{}",
            json!({ "jsonrpc": "2.0", "method": method })
        )
        .unwrap();
    }

    /// One request and its response. Every line on stdout must be a JSON-RPC message.
    pub fn call(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        writeln!(
            self.stdin,
            "{}",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        )
        .unwrap();
        loop {
            let mut line = String::new();
            assert!(
                self.stdout.read_line(&mut line).unwrap() > 0,
                "stdout closed:\n{}",
                self.stderr.text()
            );
            let message: Value = serde_json::from_str(&line)
                .unwrap_or_else(|_| panic!("stdout carried a non-JSON line: {line}"));
            if message["id"] == json!(id) {
                return message;
            }
        }
    }

    /// The tool list.
    pub fn tools(&mut self) -> Vec<Value> {
        self.call("tools/list", json!({}))["result"]["tools"]
            .as_array()
            .unwrap()
            .clone()
    }

    /// The text of a tool's single text block.
    pub fn text(&mut self, name: &str) -> String {
        text_of(&self.call("tools/call", json!({ "name": name, "arguments": {} })))
    }
}

impl Drop for StdioClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The text of a successful single-block tool result, from a JSON-RPC response.
pub fn text_of(response: &Value) -> String {
    let result = &response["result"];
    assert_ne!(
        result["isError"],
        json!(true),
        "expected a successful result: {response}"
    );
    let content = result["content"].as_array().expect("content");
    assert_eq!(content.len(), 1, "expected exactly one content block");
    assert_eq!(content[0]["type"], "text");
    content[0]["text"].as_str().unwrap().to_string()
}
