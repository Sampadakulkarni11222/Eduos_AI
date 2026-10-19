# Live CCTV: setup guide

EduOS can show the school's own cameras live to a small number of authorised staff. It does not record, store or
analyse video. It plays what the school's own NVR/VMS or video gateway already produces, through a short-lived,
logged link. This guide covers what a school needs, how to connect it, and the privacy rules that go with it.

The feature is **off by default** (`cctvLive`). Switching it on does not connect anything by itself.

## 1. How it works

```
Cameras (RTSP) ──► School NVR/VMS or gateway (MediaMTX / go2rtc) ──https──► EduOS backend ──► Browser
                    converts RTSP to WebRTC (WHEP) or HLS            signs, proxies, logs     watermarked, view-only
```

- **RTSP cannot play in a browser.** Every camera speaks RTSP; browsers play WebRTC and HLS. A gateway converts it.
  EduOS refuses an `rtsp://` address and tells you to add the camera to the gateway instead.
- **WebRTC (WHEP)** is recommended: under a second of delay and every modern browser plays it. The browser sends its
  WebRTC offer to EduOS; EduOS adds the gateway credentials, forwards it, and returns only the answer. Video then
  flows from the gateway to the browser.
- **HLS (.m3u8)** works where the browser plays HLS natively (Safari, iOS, most Android browsers). EduOS proxies the
  playlist and every segment and rewrites every address in the playlist to an opaque reference, so the browser never
  learns the gateway address or a camera path. Chrome/Firefox desktop without native HLS: use WHEP.
- **The browser never gets** the gateway address, a camera path, a user name, a password or a token for the gateway.
  It gets a 5-minute playback token bound to the viewer, the camera, their network address and their browser. The
  page renews it while the person keeps watching.

## 2. Supported patterns

| You have | What to do |
| --- | --- |
| IP cameras + NVR (Hikvision, Dahua, CP Plus, Uniview…) | Run MediaMTX or go2rtc next to the NVR and pull each camera's RTSP from the NVR or the camera. |
| A VMS with a WebRTC/WHEP or HLS output (Milestone, Nx Witness, Frigate, Shinobi, Blue Iris…) | Point EduOS at that output if it is https and supports a read-only user; otherwise put MediaMTX in front. |
| Cloud NVR | Use its HLS/WebRTC export only if it allows a server-side read user; never share an owner login. |

### MediaMTX (example)

`mediamtx.yml` (one path per camera; audio off):

```yaml
webrtc: yes
webrtcAddress: :8889
hls: yes
hlsAddress: :8888
authInternalUsers:
  - user: eduos            # read-only user EduOS signs in as
    pass: <long random password>
    permissions:
      - action: read
paths:
  main-gate:
    source: rtsp://viewer:<cam-password>@192.168.1.64:554/Streaming/Channels/102
    sourceOnDemand: yes
  bus-bay:
    source: rtsp://viewer:<cam-password>@192.168.1.65:554/Streaming/Channels/102
    sourceOnDemand: yes
```

- WHEP path for EduOS: `main-gate/whep` (served on the WebRTC port). HLS path: `main-gate/index.m3u8` (HLS port).
- Use the camera's **sub-stream** (lower resolution): it is enough to see a corridor and costs far less bandwidth.
- Set `webrtcAdditionalHosts` to the address viewers reach the gateway on, or run a TURN server, so WebRTC works
  from outside the school network.

### go2rtc (example)

```yaml
streams:
  main-gate: rtsp://viewer:<cam-password>@192.168.1.64:554/Streaming/Channels/102
api:
  listen: ":1984"
  username: eduos
  password: <long random password>
```

- WHEP path for EduOS: `api/webrtc?src=main-gate`. HLS path: `api/stream.m3u8?src=main-gate`.

## 3. HTTPS and network

- EduOS reaches the gateway **only over https** with a valid certificate. Put the gateway behind a reverse proxy
  (Caddy, nginx with Let's Encrypt) or a tunnel (Cloudflare Tunnel, Tailscale Funnel) on a name such as
  `https://cctv.yourschool.in/`. One gateway serves all cameras; all paths sit under that address.
- Expose **only the gateway**, never the NVR or the cameras. Keep cameras on their own VLAN.
- EduOS refuses private, loopback, link-local (169.254.x, cloud metadata) and other reserved addresses, refuses
  redirects, and caps sizes and times on every request. Platform operators can also restrict gateway hosts with
  `CCTV_GATEWAY_HOSTS=cctv.school1.in,.tunnel.example` (exact host or `.suffix`).
- **On-premise install** (EduOS on the school LAN): set `CCTV_ALLOW_PRIVATE_GATEWAY=true` to allow a gateway on a
  private address. Link-local and multicast addresses stay refused.
- Bandwidth: a sub-stream is about 0.5 to 1 Mbit/s per viewer. HLS passes through the EduOS server; WHEP does not.

## 4. Connect it in EduOS

1. **Settings → Features**: switch on *Live CCTV viewing*.
2. **Live CCTV → Setup** (safety officer, `camera.devices.manage`): enter the gateway address, type and the
   read user and password (or token). They are stored encrypted and never shown again. Press **Test connection**.
3. **Register each camera**: name, zone (for the grid), place, purpose, camera group, stream type and its path on the
   gateway, and who approved it. Toilets, washrooms, changing rooms, dormitory rooms, the health room/clinic and
   staff private areas (staff room, staff lounge, counselling) are refused. A camera in a hostel may cover corridors
   only.
4. **Who may watch**: the principal and the safety/compliance officer hold `camera.live.view` by default. To let
   another role watch some cameras, grant it `camera.live.view` at OWN scope in Access & Permissions and, in Setup,
   give that role its camera groups (e.g. `WARDEN: hostel`, a transport head: `bus-bay`). Parents, students and alumni
   are refused by the server even if someone grants them the permission. Administrators can register cameras but not
   watch unless the school grants them the permission deliberately (audited).
5. Optional: **ask every viewer for a reason**. Cameras in restricted areas (classrooms, labs, hostel corridors)
   always ask.

Without a connected gateway the Live CCTV page says "No camera connected: set up your NVR/gateway" with these steps.
It never shows sample footage.

## 5. What viewers get

- A grid of the cameras they may watch, by zone, with online/offline status (checked every 15 minutes, or on
  **Check status**); single view; fullscreen.
- View-only: no recording, download, snapshot, picture-in-picture or audio. The viewer's name and the time are
  watermarked over the picture.
- "Still watching?" after the school's idle time (default 10 minutes); unanswered, the viewing ends and the token
  stops working. A single viewing lasts at most the school's limit (default 60 minutes).
- Campus World shows a camera button on rooms and zones that have a camera the person may watch; it opens the Live
  CCTV page.
- Ask AI / WhatsApp: "which cameras are online", "show me the view log for today", "open the main gate camera". The
  assistant returns status or a link to the page, never video.

## 6. Logging and oversight

- Every viewing is recorded: who, which camera, start, end, how it ended (closed, timed out, time limit, access
  removed, camera switched off) and the reason given. Start and end are also in the audit log (`cctv.view.start`,
  `cctv.view.end`), as are refused attempts, camera and settings changes (never a credential).
- The principal and the safety officer see everyone's viewings in **View log**; other viewers see their own.

## 7. Privacy, DPDP and signage

- **Purpose and proportionality.** Record why each camera exists (the approval note) and keep cameras to safety and
  security purposes. Live viewing is for safety checks, not for watching teaching or individual children.
- **Never** in toilets, washrooms, changing rooms, dormitory rooms, the health room or staff private areas. EduOS
  refuses these places; the school must also not point other cameras into them.
- **Signage**: put up clear CCTV notices at entrances and every monitored area, saying who operates the cameras, why,
  and whom to contact. Many state guidelines and school boards expect this; it is also part of being transparent
  under the Digital Personal Data Protection Act, 2023 (DPDP).
- **DPDP**: video of identifiable people, including children, is personal data. Name the school as the data
  fiduciary, give the purpose in the school privacy notice, limit who can watch (this feature's permission and
  groups), keep the view log, and handle access/erasure requests through the Data Protection page. Children's data
  needs particular care: no tracking or behavioural monitoring of children.
- **Retention**: EduOS keeps no video. Recording and retention happen on the school NVR; set a short period (commonly
  15 to 30 days, or what the board or police guidance for your state requires) and delete after it, except footage
  held for a recorded incident. The view log and audit entries are kept with the school's audit records.
- **Parents** never get live video. Parent and student views show the 3D campus and counts only.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| "No camera connected" | Gateway address not saved, or feature off. |
| Test connection: "inside a private network" | Use a public https name (proxy/tunnel), or `CCTV_ALLOW_PRIVATE_GATEWAY` on-premise. |
| Test connection: HTTP 401/403 | Read user/password wrong, or the user lacks read permission on the gateway. |
| Camera "Offline" | Path wrong (`STREAM_NOT_FOUND`), camera off, or the gateway cannot reach the camera's RTSP. |
| WHEP connects but stays black | WebRTC ICE: set `webrtcAdditionalHosts` / a TURN server; open UDP 8189 (MediaMTX). |
| "This browser cannot play HLS directly" | Switch the camera to WHEP, or use Safari. |
| Playback stops after a network change | The token is bound to the viewer's address and browser; open the camera again. |
