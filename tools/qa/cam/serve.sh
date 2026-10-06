#!/bin/bash
# persistent static server for PORT 8793 (qa.py's own server thread fails if the port is already bound)
cd /home/claude/game
while true; do python3 -m http.server 8793 --bind 127.0.0.1 >/dev/null 2>&1; sleep 2; done
