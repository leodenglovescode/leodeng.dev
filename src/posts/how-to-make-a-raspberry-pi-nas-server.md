---
title: "How to make a Raspberry Pi NAS server"
date: 2022-04-09T19:20:00+08:00
description: "Turning a Raspberry Pi 4B and a leftover drive into a Samba file server you can reach from every machine in the house."
---

> [!NOTE]
> Originally posted on my old blog in April 2022. Kept as written — the prices, the links and the advice are all from 2022.

Imagine this senario, you need a lot of pictures and/or important files stored someplace locally, and you want to access it through every computer/phone, but all of your storage is full, how do you store those pictures/files?

Well, the Raspberry pi can be a great soulution. The Raspberry Pi uses a lot less power than a regular NAS server, and it's pretty cheap and easy to setup. So here's how to make it...

## Step 1: Getting the components

First, you need these components, some are needed and some are optional:

1. **Raspberry Pi 4B / 2G RAM** — $35 Dollars ¥223 Yuan (You can buy the 4G and 8G version, but it's more pricey)
2. **Case for Raspberry Pi** (Optional) — If you are a geek, you can 3D print one like I did, anyways, [here it is](https://media.leodeng.dev/raspberry-pi-nas-case-files.zip). (Credit to Michael Klements for designing the case (Aaaand making his own tutorial of the making of the case), he is a great tech youtuber and you should definitely check him out!)
3. **Micro SD Card** (Sandisk 32 GB here) — 14 Dollars/89 RMB. This is for system installation, or if you only have a few files, using a 32 gigabyte sd card would be fine.
4. **SSD or HDD** (Optional) (Can be Leftover SSD or HDDs)
5. **I2C display** (Optional if you want the case)
6. **3.3V Fan** (Optional if you want the case)

## Step 2: Installing the Raspberry Pi OS

1. Download the Raspberry Pi OS from [here](https://www.raspberrypi.org/software/operating-systems/). If you want a GUI Graphical Desktop to do gui applications, you can download the full version, but if you want it to be a lighter system and run more smoothly as a NAS server, use the lite version of the OS.
2. Open Win32DiskImager and choose the image and transfer it to the Micro SD card **OR** use Etcher on mac and Rufus on windows, same steps.
3. Plug the Micro SD card into the raspberry pi and start it.

## Step 3: Commands for the SMB server

1. Open a terminal and enter this command, this command installs the samba module which is used to create the SMB server:

   ```bash
   sudo apt-get install samba
   ```

2. After the necessary installation, use nano or vim to edit this file:

   ```bash
   sudo nano /etc/samba/smb.conf
   # or
   sudo vim /etc/samba/smb.conf
   ```

3. Write these lines of code at the end of the file. Inside the top big braclet `[]`, you should write your NAS Share name there without spaces, e.g. `admins-nas-share`, `Nas-share`. The path should be the folder you want to share (Must be created) e.g. `/home/pi/NAS-SHARE`.

   ```ini
   [Your NAS Share Name (No Spaces)]
   path = /Your/path/to/the/folder
   writeable=Yes
   create mask=0777
   directory mask=0777
   public=no
   ```

4. Create an account on samba with your Raspberry Pi username. After the terminal prompts you for an password, enter your desired password for samba.

   ```bash
   smbpasswd -a (your raspberry pi user account)
   ```

5. Restart the samba service:

   ```bash
   sudo systemctl restart smb
   ```

6. Connect to your file-sharing service. On macOS, go to the "Finder Menu bar":

   ![The macOS Finder menu bar](https://media.leodeng.dev/rpi-nas-finder-menu-bar.webp)

   Click "Go" and click "Connect to server":

   ![The Go menu with Connect to Server highlighted](https://media.leodeng.dev/rpi-nas-connect-to-server.webp)

   After that, enter your NAS server's ip address and your NAS share name and click "Connect":

   ![The Connect to Server dialog with the smb address filled in](https://media.leodeng.dev/rpi-nas-connect-samba-ip.webp)

   Click on your server and enter the **samba** credentials.

Now you are done! Access all of your saved files, images, videos on the server!

Here's a showcase of the server:

![The finished NAS in its 3D-printed case](https://media.leodeng.dev/rpi-nas-showcase-1.webp)

![The NAS from another angle, showing the drive bays](https://media.leodeng.dev/rpi-nas-showcase-2.webp)

![The NAS running, with the I2C display lit up](https://media.leodeng.dev/rpi-nas-showcase-3.webp)

Now doesn't that look good? :3

Bye!
