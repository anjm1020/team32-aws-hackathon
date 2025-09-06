#!/bin/bash
export UV_CACHE_DIR=""
cd ~/amazonq-hackathon
sudo yum install -y python3-pip
python3 -m pip install --user -r requirements.txt
python3 app.py
