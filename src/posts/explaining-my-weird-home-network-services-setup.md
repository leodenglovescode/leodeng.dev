---
title: "Explaining my weird home network & services setup"
date: 2026-08-07T00:30:00+08:00
description: "Small peek at my setup as a sysadmin :)"
---

## About My Network Setup...

So... Yeah I admit it. My home network is WEIRD, partly because I'm literally 16 years old, partly because I'm broke. But also it's weird in a good way (kinda), the network is sort of like an intricate web that connects all my important devices together, and that delicacy is held together by LAN cables that are either under the carpet or on the floor , which, if you think about it, is a terrible choice for a sysadmin.


## Diagrams... Fun!

But anyways, lets get to the actual structure of my LAN network by showing you this mermaid diagram:

```mermaid

	%%{init: {"flowchart": {"useMaxWidth": true}}}%%
	flowchart TD

    ONT["ONT (Optical Network Terminal)<br/>Bridge Mode"]
    BE3["Main Router"]

    ONT --> BE3

    %% Second Floor
    SW2F["Dumb LAN Switch<br/>2nd Floor<br/>1000 Mbps"]

    NAS["NAS"]
    SERVER["Main Server"]
    Q2["Router #2<br/>(Acts as Wi-Fi Extender)"]
    SW2F100["Dumb Switch<br/>100 Mbps"]

    BMC["Main Server BMC"]
    PRINTER["Printer"]

    BE3 -->|1 Gbps| SW2F

    SW2F --> NAS
    SW2F --> SERVER
    SW2F --> Q2

    Q2 -->|100 Mbps| SW2F100
    SW2F100 --> BMC
    SW2F100 --> PRINTER

    %% First Floor
    SW1F["Dumb LAN Switch<br/>1st Floor<br/>1000 Mbps"]

    WINPC["PC"]
    BOSE["Central Speaker"]
    HA["Home Assistant Server"]
    SW1F100["Dumb LAN Switch<br/>100 Mbps"]

    DOORCAM["Door Camera"]
    LRCAM["Living Room Camera"]

    BE3 -->|1 Gbps| SW1F

    SW1F --> WINPC
    SW1F --> BOSE
    SW1F --> HA
    SW1F -->|100 Mbps| SW1F100

    SW1F100 --> DOORCAM
    SW1F100 --> LRCAM

    %% Styling
    classDef wan fill:#6c5ce7,stroke:#a29bfe,color:#fff,stroke-width:2px
    classDef router fill:#0984e3,stroke:#74b9ff,color:#fff,stroke-width:2px
    classDef switch fill:#e17055,stroke:#fab1a0,color:#fff,stroke-width:2px
    classDef server fill:#00b894,stroke:#55efc4,color:#fff,stroke-width:2px
    classDef endpoint fill:#636e72,stroke:#b2bec3,color:#fff
    classDef camera fill:#d63031,stroke:#ff7675,color:#fff

    class ONT wan
    class BE3,Q2 router
    class SW2F,SW2F100,SW1F,SW1F100 switch
    class NAS,SERVER,BMC,HA server
    class WINPC,BOSE,PRINTER endpoint
    class DOORCAM,LRCAM camera
```

And I can pretty much say that this setup works great! (though there is a bit of a spaghetti cable situation that needs action)

## Thoughts on switches

I initially thought those dumb and cheap VLAN switches would SERIOUSLY decapacitate my network's speed, but it turns out they remained basically the same 1gbps throughput up AND down, which is surprising considering these switches (5 port, 4 port usable), are around 70 CNY (10.37 USD) a piece.

So I began wondering how this works, then I found it: cheap VLAN switches don’t lose much speed because packet forwarding is handled by dedicated switching hardware, not a slow general-purpose CPU. VLAN tagging adds only a tiny amount of extra data, and modern switch chips can process it at full line rate. The real bottleneck is usually the Ethernet port itself, so thats why I lost no speed!

Now THAT'S what I call a bang for the buck.

# Self-hosted services I am running...

### Main Server Services:

NGINX - Load balancer and webserver in front of my website backend

Grafana - Server/Website traffic Monitoring

Immich - Photo gallery

Jellyfin - Media indexer & Player

Scriberr - Audio/Video transcription (Speech-To-Text)

VaultWarden - Password Manager

Frigate - Cameras & NVR

CarbonPanel - Custom built real-time server monitoring panel

MCSManager - Manager for my minecraft server


## Thinkpad E450 Services (Yes its a repurposed old laptop lol, still works great.)

Home Assistant - Home Controls & Monitoring

<br/><br/>

Right that's about it for this blog, thanks again for reading to the very end and see ya next time!
