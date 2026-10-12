FROM python:3.13-slim

# Install system dependencies including Node.js, Bluetooth/BLE support and Git
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    v4l-utils \
    bluetooth \
    bluez \
    libglib2.0-dev \
    build-essential \
    avrdude \
    git \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Install Python dependencies for Chihiros LED control and ESP32 flashing
RUN pip install --no-cache-dir bleak bleak-retry-connector rich esptool "typer>=0.9.0,<0.13.0" "click>=8.0.0,<8.2.0"
RUN pip3 install pyserial
# Clone and install user's fork of Chihiros LED control (works without HA)
RUN git clone https://github.com/savergiggio/chihiros-led-control.git /app/chihiros-led-control \
    && cd /app/chihiros-led-control \
    && pip install -e .

# Copy application code
COPY . .

# Make entrypoint script executable
RUN chmod +x /app/entrypoint.sh

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
