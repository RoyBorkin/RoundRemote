-- /etc/wireplumber/main.lua.d/51-roundremote-no-hdmi.lua (WirePlumber 0.4, Bookworm) — installed by pi/install.sh
-- when a USB / I2S speaker is present: hide the HDMI audio outputs so sound goes to the speaker.
table.insert(alsa_monitor.rules, {
  matches = { { { "device.name", "matches", "alsa_card.platform-*hdmi*" } } },
  apply_properties = { ["device.disabled"] = true },
})
