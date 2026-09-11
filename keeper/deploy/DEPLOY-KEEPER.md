# Deploy Keeper ke VPS (Hostinger)

Runbook untuk menjalankan keeper (loop eksekusi) + delegate server (HTTP untuk
frontend) di VPS Ubuntu, dengan HTTPS dan auth token. Target: satu domain
mengarah ke VPS (Caddy auto-HTTPS), keeper & delegate server tetap di
loopback — hanya 22/80/443 yang terbuka.

## 0. Prasyarat

- VPS Ubuntu 22.04/24.04, akses SSH root/user sudo.
- Sebuah domain (atau subdomain) yang A-record-nya mengarah ke IP VPS —
  contoh di bawah memakai `keeper.example.com`. Tanpa domain? Gunakan
  cloudflared tunnel (bagian 6).
- File rahasia dari mesin lokal (JANGAN lewat git):
  - `keeper/.env` — GRAPH_API_KEY, PRIVY_APP_ID, PRIVY_APP_SECRET,
    KEEPER_POLL_INTERVAL_SECONDS=60, KEEPER_DELEGATE_TOKEN=<secret acak>
  - `keeper/.keystore.json` — kunci signing posisi yang didelegasikan

Transfer rahasia (dari mesin lokal):

```sh
scp keeper/.env keeper/.keystore.json user@VPS_IP:/tmp/
```

## 1. Setup awal di VPS (jalankan sebagai root)

```sh
apt update && apt upgrade -y
apt install -y curl git caddy ufw
# Node 22 + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pnpm

# User khusus + kode
useradd -m -s /bin/bash slope
mkdir -p /opt/slope
git clone https://github.com/EndPx/slope.git /opt/slope/repo
chown -R slope:slope /opt/slope

# Firewall: hanya SSH + web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Rahasia + build

```sh
su - slope
cd /opt/slope/repo/keeper
cp /tmp/.env .env && cp /tmp/.keystore.json .keystore.json
chmod 600 .env .keystore.json
pnpm install --frozen-lockfile
```

`.env` wajib berisi `KEEPER_DELEGATE_TOKEN` (buat acak: `openssl rand -hex 24`)
— nilainya nanti dipakai frontend lewat env `VITE_KEEPER_TOKEN` di Vercel.

## 3. systemd — dua service

Salin `slope-keeper.service` dan `slope-delegate.service` dari folder ini ke
`/etc/systemd/system/`, lalu:

```sh
systemctl daemon-reload
systemctl enable --now slope-keeper slope-delegate
systemctl status slope-keeper slope-delegate --no-pager
```

- `slope-keeper` — loop eksekusi (poll subgraph → tanda tangan → broadcast).
- `slope-delegate` — HTTP di 127.0.0.1:8787 untuk frontend.

## 4. HTTPS via Caddy

`Caddyfile` dari folder ini → `/etc/caddy/Caddyfile` (ganti domain), lalu:

```sh
systemctl reload caddy
```

Caddy menerbitkan sertifikat otomatis (HTTP-01). Frontend kini bisa memanggil
`https://keeper.example.com/delegate`.

## 5. Sambungkan ke frontend (Vercel)

Di project Vercel, tambahkan environment variables lalu redeploy:

- `VITE_KEEPER_URL` = `https://keeper.example.com`
- `VITE_KEEPER_TOKEN` = isi `KEEPER_DELEGATE_TOKEN` yang sama

## 6. Alternatif tanpa domain: cloudflared tunnel

```sh
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

URL `https://<acak>.trycloudflare.com` tercetak — pakai sebagai
`VITE_KEEPER_URL`. Catatan jujur: URL quick tunnel berubah setiap restart
tunnel; untuk URL stabil, buat tunnel bernama dengan domain di Cloudflare
(gratis), atau pakai Caddy + domain sendiri.

## 7. Upgrade kode

```sh
cd /opt/slope/repo && git pull
systemctl restart slope-keeper slope-delegate
```
