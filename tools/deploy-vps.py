#!/usr/bin/env python3
# Empire of Safavids — automated VPS deployment
import paramiko, os, sys, time, secrets
from pathlib import Path

HOST = "45.32.220.58"
USER = "root"
PASSWORD = "REDACTED"
REPO_ROOT = Path(r"D:\My Projects\Empire of Sefevids")
DEPLOY_DIR = REPO_ROOT / "deploy"
REMOTE_DIR = "/root/eos-deploy"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"[1/8] Connecting to {HOST}...", flush=True)
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
print("[2/8] Connected!\n", flush=True)

def run(cmd, cwd=None, check=True, timeout=120):
    print(f"  $ {cmd}", flush=True)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(f"  > {out[:600]}", flush=True)
    if err and not check: print(f"  ! {err[:300]}", flush=True)
    exit_code = stdout.channel.recv_exit_status()
    if check and exit_code != 0:
        raise RuntimeError(f"Command failed (code {exit_code}): {cmd}\n{err}")
    return out

# Check Docker
print("[3/8] Checking environment...", flush=True)
docker_ok = run("docker --version 2>/dev/null && echo OK || echo MISSING", check=False)
compose_ok = run("docker compose version 2>/dev/null && echo OK || echo MISSING", check=False)
has_docker = "OK" in docker_ok
has_compose = "OK" in compose_ok
print(f"  Docker: {'OK' if has_docker else 'MISSING'}", flush=True)
print(f"  Compose: {'OK' if has_compose else 'MISSING'}\n", flush=True)

if not has_docker:
    print("[4/8] Installing Docker...", flush=True)
    run("apt update -qq")
    run("apt install -y -qq ca-certificates curl gnupg lsb-release")
    run("install -m 0755 /dev/stdin /etc/apt/keyrings/docker.asc <<'EOF'")
    run("curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.asc 2>/dev/null")
    run("chmod a+r /etc/apt/keyrings/docker.asc")
    run('echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null')
    run("apt update -qq")
    run("apt install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin")
    print("  Docker installed!\n", flush=True)

# Upload files via SFTP
print("[5/8] Uploading deploy/ to server...", flush=True)
sftp = ssh.open_sftp()

def upload_dir(local, remote, sftp):
    if local.is_dir():
        try: sftp.mkdir(remote)
        except: pass
        for item in sorted(local.iterdir()):
            upload_dir(item, f"{remote}/{item.name}", sftp)
    else:
        sftp.put(str(local), f"{remote}/{local.name}")
        sz = local.stat().st_size
        print(f"  UP {local.name} ({sz//1024}KB)", flush=True)

upload_dir(DEPLOY_DIR, REMOTE_DIR, sftp)
sftp.close()
print("  Upload complete!\n", flush=True)

# Generate .env
print("[6/8] Creating .env...", flush=True)
pg_pass = secrets.token_hex(16)
jwt_sec = secrets.token_hex(32)
domain = "game.sefevids.online"

env_content = f"""# Empire of Safavids production config
DOMAIN={domain}
POSTGRES_PASSWORD={pg_pass}
JWT_SECRET={jwt_sec}
CLIENT_ORIGIN=https://{domain}
"""

env_path = f"{REMOTE_DIR}/.env"
run(f"cat > {env_path} <<'ENVEOF'\n{env_content}ENVEOF")
verify = run(f"cat {env_path}", check=False)
print(f"  DOMAIN={domain}", flush=True)
print(f"  POSTGRES_PASSWORD={pg_pass[:8]}...", flush=True)
print(f"  JWT_SECRET={jwt_sec[:8]}...", flush=True)
print("  .env created!\n", flush=True)

# Check required files
print("[7/8] Verifying files...", flush=True)
prod_exists = run(f"test -f {REMOTE_DIR}/docker-compose.prod.yml && echo OK || echo MISSING", check=False)
caddy_exists = run(f"test -f {REMOTE_DIR}/Caddyfile && echo OK || echo MISSING", check=False)
env_exists = run(f"test -f {env_path} && echo OK || echo MISSING", check=False)
print(f"  docker-compose.prod.yml: {prod_exists.strip()}", flush=True)
print(f"  Caddyfile: {caddy_exists.strip()}", flush=True)
print(f"  .env: {env_exists.strip()}", flush=True)

if prod_exists.strip() != "OK":
    print("  Restoring from git...", flush=True)
    run(f"cd {REPO_ROOT} && git show HEAD:deploy/docker-compose.prod.yml > {REMOTE_DIR}/docker-compose.prod.yml")
    run(f"cd {REPO_ROOT} && git show HEAD:deploy/Caddyfile > {REMOTE_DIR}/Caddyfile")
    print("  Restored!\n", flush=True)

# Launch!
print("[8/8] STARTING GAME SERVER...", flush=True)
run(f"cd {REMOTE_DIR} && docker compose -f docker-compose.prod.yml --env-file .env up -d --build", timeout=600)

time.sleep(15)

# Verify
print("\n=== STATUS ===", flush=True)
run(f"cd {REMOTE_DIR} && docker compose -f docker-compose.prod.yml ps")
health = run(f"curl -s http://localhost/game/health 2>/dev/null || echo WAITING...", check=False)
print(f"\nHealth: {health[:200]}", flush=True)

print(f"\n[OK] DONE! Game available at: https://{domain}/game/")
print(f"Logs: docker compose -f {REMOTE_DIR}/docker-compose.prod.yml logs -f")

ssh.close()
