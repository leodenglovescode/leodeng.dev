---
title: "I added post-quantum encryption to my website"
date: 2026-10-10T13:21:00+08:00
description: "A connection dashboard, a GPS clock comparison, and a keyboard command palette. A few small updates that made this site more fun."
---
## Intro
So I added a few fun additions to my site, most of them are just for fun, but the rest is really QoL (Quality of Life) updates:

### Changes include:
- [/time page](/time): gps+pps clock time sent staright from my Raspberry Pi Watchdog (Also added latency correction for the connection lantency, turned out to be pretty accurate ngl)
<br/><br/>
- [/ip page](/ip): A connection page for showing you stats of your own connection, really useful for checking ip/asn and your browser's TLS/Cryptography capabillites (this is the QoL update)
<br/><br/>
- [/terminal page](/terminal): A terminal for sysadmins/geeks who wants to browse the site in a real 10mb linux vm running in your terminal, made possible by WebAssembly (Browser → v86 JavaScript/WebAssembly emulator → Linux kernel → shell and programs)
<br/><br/>
- Cmd+K/Ctrl+K: Opens a command palette. Search pages and blog posts

<br/><br/>
## Under the hood

Seeing “You’re using post-quantum encryption” on my own website is actually really fun 😀
<br/><br/>
As to how this is possible without a backend API request to my server: It turns out that Cloudflare already provides the connection data for this site (Existing API for Cloudflare Pages site at /cdn-cgi/trace). And after adding my api, I made it visible.

<br/><br/>
Here is the cloudflare default API response from /cdn-cgi/trace if anybody is interested:
```
fl=redacted        #cf internal ident for load balancer
h=leodeng.dev      #hostname
ip=redacted        #connecting ip 
ts=1791610428.000  #timestamp since Jan 1, 1970
visit_scheme=https #connection scheme
uag=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36.     #user-agent
colo=LAX           #datacenter handling the request
sliver=050-tier1   #An internal software rollout group
http=http/2        #HTTP protocol version
loc=US             #Country/region inferred from the connecting IP
tls=TLSv1.3        #Negotiated TLS version
sni=plaintext      #Hostname sent in plaintext via TLS SNI
warp=off           #Request wasn't detected as arriving through Cloudflare WARP
gateway=off        #Cloudflare Zero Trust Gateway wasn't detected for this request
rbi=off            #Remote Browser Isolation wasn't used for this request
kex=X25519MLKEM768  #Hybrid key exchange: X25519 + post-quantum ML-KEM-768
```

<br/><br/>

## Some more thoughts

I think what I enjoyed most was finding out how much of the internet’s plumbing is already there, quietly doing its job every single day, protecting the privacy of millions. I use HTTPS every day (and so does almost all people accessing the internet), but looking at the actual key exchange made me curious about what happens behind that little padlock in the browser.