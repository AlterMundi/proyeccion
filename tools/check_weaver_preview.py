"""Run the browser check against an isolated Weaver application and release archive."""

import argparse
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import uvicorn
from harmonic_weaver.lab.app import create_app


def install_consumer(consumer, archive):
    consumer.mkdir()
    (consumer / "package.json").write_text('{"private":true,"type":"module"}\n', encoding="utf-8")
    npm = os.environ.get("npm_execpath")
    command = ["node", npm] if npm else ["npm"]
    subprocess.run(
        [*command, "install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund",
         str(archive), "three@0.182.0"],
        cwd=consumer, check=True, timeout=120,
    )


def exercise_preview(data, ui, consumer):
    app = create_app(data, ui_dir=ui)
    checker = Path(__file__).with_name("check_weaver.js").resolve()
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        address = listener.getsockname()
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 12
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.05)
            if not server.started:
                raise RuntimeError("The disposable Weaver preview did not start")
            result = subprocess.run(
                ["node", str(checker), f"http://{address[0]}:{address[1]}/", str(consumer)],
                check=True, timeout=90, text=True, stdout=subprocess.PIPE,
            )
            receipt = json.loads(result.stdout.splitlines()[-1])
        finally:
            server.should_exit = True
            thread.join(timeout=8)
            if thread.is_alive():
                raise RuntimeError("The disposable Weaver preview did not shut down")
    return {**receipt, "stopped": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("weaver", type=Path, help="Weaver checkout with a built laboratory UI")
    parser.add_argument("archive", type=Path, help="Proyeccion package tarball")
    args = parser.parse_args()
    ui = args.weaver.resolve() / "laboratory-ui" / "dist"
    archive = args.archive.resolve()
    if not (ui / "index.html").is_file():
        parser.error("Build the selected Weaver checkout's laboratory UI first")
    if not archive.is_file():
        parser.error("Provide an existing renderer package tarball")

    with tempfile.TemporaryDirectory(prefix="proyeccion-weaver-") as root:
        temporary = Path(root)
        consumer = temporary / "consumer"
        install_consumer(consumer, archive)
        receipt = exercise_preview(temporary / "data", ui, consumer)
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
