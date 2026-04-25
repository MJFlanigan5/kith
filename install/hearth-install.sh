#!/usr/bin/env bash

# Copyright (c) 2026 Mike Flanigan
# Author: MJFlanigan5
# License: MIT | https://github.com/MJFlanigan5/hearth/raw/main/LICENSE
# Source: https://github.com/MJFlanigan5/hearth

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"

color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y git
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

msg_info "Installing Hearth"
mkdir -p /opt/hearth /data
$STD git clone https://github.com/MJFlanigan5/hearth.git /opt/hearth
cd /opt/hearth
$STD npm install --omit=dev
echo "v$(node -p "require('./package.json').version")" >/opt/hearth/.version
msg_ok "Installed Hearth"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/hearth.service
[Unit]
Description=Hearth Family Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hearth
Environment=DATA_DIR=/data
Environment=PORT=7400
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl enable -q --now hearth
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
