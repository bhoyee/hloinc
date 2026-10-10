# ClamAV signing certificate

`clamav.crt` is ClamAV's public root certificate ("Cisco Software Identity Root CA",
valid to 2099), from https://github.com/Cisco-Talos/clamav/blob/clamav-1.5.4/certs/clamav.crt.

ClamAV 1.5 needs it to verify its virus database before scanning. The cPanel copy of
ClamAV on our server is missing its certs folder, so `src/services/virusScan.js` passes
this folder to `clamscan --cvdcertsdir`. It is a public certificate, not a secret.
