---
title: "Raspberry Pi PDA"
date: 2024-04-05T11:55:20+08:00
description: "Building a handheld Raspberry Pi 4B with its own battery, speakers and 3D-printed case, for about ¥150 in parts."
---

> [!NOTE]
> Originally posted on my old blog in April 2024 — a build log plus a separate "Tutorial Part 1" that never got a part 2, merged into one post here.

Hey!

As I have mentioned in the last blog, I was preparing to make a small Raspberry Pi PDA (or Handheld PC) using my spare RPI 4B, and after about 20 days or so, I am 90% done building it, so the objective was to build a compact device to code (definitely not for hacking lol) and to take everywhere, so I listed some basic functions:

1. Charge-free for at least 2 hours under full load (2 Amps)
2. Fits in my hands
3. Adequately cooled
4. No external Keyboard or mouse unless necessary
5. External USB 3.0 Ports
6. External FULL-SIZED HDMI port
7. System designed for purely ethical hacking (I Promise :3)
8. Plays Sound

## Components list

With all those function requirements, I went to work and made a components list.

1. Raspberry Pi 4B (x1)
2. 32 GB SD Card (x1)
3. 3.7v 3000mah Lithium Polymer Battery (Totals 6000mah) (x2)
4. Charge/Boost Converter 2 in 1 Module (x1)
5. Type-C Female Port (x2)
6. Micro HDMI Male to HDMI Female Connector (x1)
7. 18 AWG Wires (x4)
8. Rectangular On-Off Switch (x1)
9. 3.5 AUX Male to Positive/Negative Wire (x1)
10. 8Ω 2W Wired Water-proof Speakers (x1)
11. Rii Mini X1 Keyboard (x1)
12. USB 3.0 2-port conjoined Female Port (x1)

Here is some pictures of the components in case you can't find it:

USB 3.0 2-port conjoined Female Port:

![A conjoined two-port USB 3.0 female connector](/blog-media/rpi-pda-usb3-connector.webp)

Rii Mini X1 Keyboard:

![The Rii Mini X1 wireless keyboard with trackpad](/blog-media/rpi-pda-rii-mini-x1.webp)

8Ω 2W Wired Water-proof Speaker:

![A small round 8-ohm waterproof speaker](/blog-media/rpi-pda-speakers.webp)

3.7v 3000mah Lithium Polymer Battery:

![A 3.7V 3000mAh lithium polymer pouch cell](/blog-media/rpi-pda-battery.webp)

## The case

Then, based on the size of the components, I modeled a case for it in Autodesk Fusion:

![Fusion render of the PDA case, front view](/blog-media/rpi-pda-case-front.webp)

![Fusion render of the PDA case, back view](/blog-media/rpi-pda-case-back.webp)

After creating the model, I bought the components, and the price was totaling about 150¥ (CNY) or about 21$ (USD), excluding the Raspberry Pi and the 32 Gigabyte MicroSD Card which I already have, then I pieced the components together and got it working without the case!
