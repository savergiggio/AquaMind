/*
 * AquaMind - ESP32-S3 Aquarium Sensor Collector
 * 
 * Hardware: ESP32-S3 DevKit
 * Communication: UART/USB Serial (No WiFi used by default to match Arduino Nano behavior)
 * 
 * Sensors:
 * - DS18B20: Water Temperature (OneWire)
 * - Analog pH Sensor (pH-4502C or similar) - NOTE: Must be 3.3V compatible or use voltage divider!
 * - Analog TDS Sensor - NOTE: Must be 3.3V compatible or use voltage divider!
 * - HC-SR04/AJ-SR04M: Water Level (Ultrasonic) - NOTE: Echo pin needs 5V->3.3V divider!
 * 
 * Pinout (Configurable below):
 * - OneWire (Temp): GPIO 4
 * - pH Sensor:      GPIO 1 (ADC1)
 * - TDS Sensor:     GPIO 2 (ADC1)
 * - Trig (Sonar):   GPIO 5
 * - Echo (Sonar):   GPIO 6
 * - I2C SDA:        GPIO 8 (Default S3) or User Config
 * - I2C SCL:        GPIO 9 (Default S3) or User Config
 */

#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <EEPROM.h>
#include <Wire.h>
#include "SSD1306Ascii.h"
#include "SSD1306AsciiWire.h"

// ============== PIN CONFIGURATION (ESP32-S3) ==============
#define ONE_WIRE_BUS 4        // DS18B20 Data Pin
#define PH_SENSOR_PIN 1       // ADC1_CH0
#define TDS_SENSOR_PIN 2      // ADC1_CH1
#define TRIG_PIN 5            // Signal Output (3.3V OK for HC-SR04)
#define ECHO_PIN 6            // Signal Input (NEEDS DIVIDER 5V->3.3V!)

// I2C Pins (ESP32-S3 Defaults often SDA=8, SCL=9, but check your board)
// If specific pins needed, set Wire.begin(SDA, SCL) in setup.
#define I2C_SDA_PIN 8
#define I2C_SCL_PIN 9

#define FW_VERSION "2.0.0-S3"

// ============== LOGIC LEVELS ==============
// ESP32 ADC is 12-bit (0-4095) and reference is 3.3V
// IF YOU USE 5V SENSORS WITH DIVIDERS, ADJUST THESE REFS!
// Assuming direct 0-3.3V input range:
#define ADC_RESOLUTION 4096.0
#define SYSTEM_VOLTAGE 3.3

// ============== OBJECTS ==============
// OLED Display
#define I2C_ADDRESS 0x3C
SSD1306AsciiWire oled;

// OneWire
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// ============== CONFIGURATION VARS ==============
// Water Level Distance Range (in cm)
float minDistance = 5.0;  // Tank full
float maxDistance = 15.0; // Tank empty

// Calibration
float phOffset = 0.0;
float tdsKValue = 1.0;
float tempOffset = 0.0;

// Configurable Voltage Refs (Adjust if using dividers)
float phVoltageRef = SYSTEM_VOLTAGE; 
float tdsVoltageRef = SYSTEM_VOLTAGE;

// EEPROM Addresses
#define EEPROM_SIZE 512
#define EEPROM_ADDR_PH     20
#define EEPROM_ADDR_TDS_K  30
#define EEPROM_ADDR_TEMP   40
#define EEPROM_ADDR_MIN_DIST 50
#define EEPROM_ADDR_MAX_DIST 60
#define EEPROM_MAGIC 100
#define MAGIC_BYTE 0xAD

// Buffers & Timing
#define SCOUNT  30
int analogBuffer[SCOUNT];
int analogBufferTemp[SCOUNT];
int analogBufferIndex = 0;
int copyIndex = 0;

#define SC_PH 30
int phBuffer[SC_PH];
int phBufferIndex = 0;
int phBufferTemp[SC_PH];

#define SC_LEVEL 20
int levelBuffer[SC_LEVEL];
int levelBufferIndex = 0;
int levelBufferTemp[SC_LEVEL];

float temperature = NAN;
float phValue = 0.0;
float tdsValue = 0.0;
float waterLevel = 0.0;

bool calMode = false;
unsigned long lastSend = 0;
unsigned long tdsSampleTime = 0;
unsigned long tdsPrintTime = 0;
unsigned long phSampleTime = 0;
unsigned long phPrintTime = 0;
unsigned long levelSampleTime = 0;

const unsigned long READ_INTERVAL = 60000; // 2 seconds

// Helper for Median
int getMedianNum(int bArray[], int iFilterLen) {
  int bTab[iFilterLen];
  for (byte i = 0; i<iFilterLen; i++) bTab[i] = bArray[i];
  int i, j, bTemp;
  for (j = 0; j < iFilterLen - 1; j++) {
    for (i = 0; i < iFilterLen - j - 1; i++) {
      if (bTab[i] > bTab[i + 1]) {
        bTemp = bTab[i];
        bTab[i] = bTab[i + 1];
        bTab[i + 1] = bTemp;
      }
    }
  }
  if ((iFilterLen & 1) > 0) bTemp = bTab[(iFilterLen - 1) / 2];
  else bTemp = (bTab[iFilterLen / 2] + bTab[iFilterLen / 2 - 1]) / 2;
  return bTemp;
}

// Smart Smoothing
float smartSmooth(float currentAvg, float newSample, float ignoreThreshold, float jumpThreshold) {
  if (isnan(currentAvg) || (currentAvg == 0.0 && newSample != 0.0)) return newSample;
  float diff = abs(newSample - currentAvg);
  if (diff > jumpThreshold) return newSample;
  if (diff < ignoreThreshold) return currentAvg;
  return (currentAvg * 0.90) + (newSample * 0.10);
}

// ============== SETUP ==============
void setup() {
  Serial.begin(115200);
  
  // Init EEPROM
  EEPROM.begin(EEPROM_SIZE);
  
  // Init Sensors
  tempSensor.begin();
  tempSensor.setWaitForConversion(false);
  tempSensor.requestTemperatures();
  
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  
  // Init I2C & OLED
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(400000L);
  oled.begin(&Adafruit128x64, I2C_ADDRESS);
  oled.setFont(Adafruit5x7);
  oled.clear();
  oled.println("AquaMind S3");
  oled.print("FW: "); oled.println(FW_VERSION);
  
  delay(1000);
  
  // Load Config
  if (EEPROM.read(EEPROM_MAGIC) == MAGIC_BYTE) {
    EEPROM.get(EEPROM_ADDR_PH, phOffset);
    EEPROM.get(EEPROM_ADDR_TDS_K, tdsKValue);
    EEPROM.get(EEPROM_ADDR_TEMP, tempOffset);
    EEPROM.get(EEPROM_ADDR_MIN_DIST, minDistance);
    EEPROM.get(EEPROM_ADDR_MAX_DIST, maxDistance);
  } else {
    EEPROM.put(EEPROM_ADDR_PH, phOffset);
    EEPROM.put(EEPROM_ADDR_TDS_K, tdsKValue);
    EEPROM.put(EEPROM_ADDR_TEMP, tempOffset);
    EEPROM.put(EEPROM_ADDR_MIN_DIST, minDistance);
    EEPROM.put(EEPROM_ADDR_MAX_DIST, maxDistance);
    EEPROM.write(EEPROM_MAGIC, MAGIC_BYTE);
    EEPROM.commit(); // ESP32 requires commit!
  }
  
  Serial.print("{\"status\":\"AquaMind ESP32-S3 Ready\", \"fw_version\":\"");
  Serial.print(FW_VERSION);
  Serial.println("\"}");
}

// ============== LOOP ==============
void loop() {
  unsigned long currentTime = millis();
  unsigned long interval = calMode ? 500 : READ_INTERVAL;
  
  // --- TDS Sampling ---
  if (currentTime - tdsSampleTime > 100U) {
    tdsSampleTime = currentTime;
    analogBuffer[analogBufferIndex] = analogRead(TDS_SENSOR_PIN);
    analogBufferIndex++;
    if (analogBufferIndex == SCOUNT) analogBufferIndex = 0;
  }
  
  // --- TDS Calc ---
  if (currentTime - tdsPrintTime > 800U) {
    tdsPrintTime = currentTime;
    for (copyIndex = 0; copyIndex < SCOUNT; copyIndex++)
      analogBufferTemp[copyIndex] = analogBuffer[copyIndex];
      
    float averageVoltage = getMedianNum(analogBufferTemp, SCOUNT) * (float)tdsVoltageRef / ADC_RESOLUTION;
    float compensationCoefficient = 1.0 + 0.02 * (temperature - 25.0);
    float compensationVoltage = averageVoltage / compensationCoefficient;
    float tdsRaw = (133.42 * pow(compensationVoltage, 3) - 255.86 * pow(compensationVoltage, 2) + 857.39 * compensationVoltage) * 0.5 * tdsKValue;
    tdsValue = smartSmooth(tdsValue, tdsRaw, 5.0, 200.0);
  }
  
  // --- pH Sampling ---
  if (currentTime - phSampleTime > 100U) {
    phSampleTime = currentTime;
    phBuffer[phBufferIndex] = analogRead(PH_SENSOR_PIN);
    phBufferIndex++;
    if(phBufferIndex == SC_PH) phBufferIndex = 0;
  }
  
  // --- pH Calc ---
  if (currentTime - phPrintTime > 800U) {
    phPrintTime = currentTime;
    for(int i=0; i<SC_PH; i++) phBufferTemp[i] = phBuffer[i];
    
    float voltage = getMedianNum(phBufferTemp, SC_PH) * (float)phVoltageRef / ADC_RESOLUTION;
    // For pH-4502C @ 5V, midpoint is 2.5V = pH 7. 
    // @ 3.3V, midpoint is ~1.65V = pH 7 theoretically if powered by 3.3V.
    // If sensor is powered by 5V and divided, voltage relation changes.
    // Assuming Linear: y = mx + q. 
    // This formula comes from pH-4502C standard: pH = 3.5 * voltage + offset is for 5V ref?
    // Let's stick to the Arduino logic but use correct voltage. User calibration handles offset.
    float rawPh = 3.5 * voltage + phOffset; 
    if (rawPh < 0) rawPh = 0;
    if (rawPh > 14) rawPh = 14;
    phValue = smartSmooth(phValue, rawPh, 0.05, 0.5);
  }
  
  // --- Level Sampling ---
  if (currentTime - levelSampleTime > 200U) {
    levelSampleTime = currentTime;
    
    // Replacement for MySonarJC library - direct pulseIn for ESP32
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    
    long duration = pulseIn(ECHO_PIN, HIGH, 25000); // Timeout 25ms (~4m)
    int rawDist = (duration > 0) ? (duration * 0.034 / 2) : 0;
    
    if (rawDist > 0) {
        levelBuffer[levelBufferIndex] = rawDist;
        levelBufferIndex++;
        if (levelBufferIndex == SC_LEVEL) levelBufferIndex = 0;
    }
  }
  
  // --- Report ---
  if (millis() - lastSend > interval) {
    lastSend = millis();
    readTemperature();
    readWaterLevel();
    sendSensorData();
    updateDisplay();
  }
  
  readSerialCommand();
}

void readTemperature() {
  float rawTemp = tempSensor.getTempCByIndex(0);
  tempSensor.requestTemperatures();
  
  if (rawTemp == DEVICE_DISCONNECTED_C || rawTemp < -50 || rawTemp == 85.0) return;
  rawTemp += tempOffset;
  temperature = smartSmooth(temperature, rawTemp, 0.15, 1.0);
}

void readWaterLevel() {
  for(int i=0; i<SC_LEVEL; i++) levelBufferTemp[i] = levelBuffer[i];
  int medianDist = getMedianNum(levelBufferTemp, SC_LEVEL);
  if (medianDist <= 0) return;
  
  float distance = (float)medianDist;
  if (distance < 1.0) return;
  
  float distanceRange = maxDistance - minDistance;
  if (distanceRange <= 0) return;
  
  float rawLevel = ((maxDistance - distance) / distanceRange) * 100.0;
  if (rawLevel < 0) rawLevel = 0;
  if (rawLevel > 100) rawLevel = 100;
  
  waterLevel = smartSmooth(waterLevel, rawLevel, 0.1, 3.0);
}

void sendSensorData() {
  Serial.print("{");
  Serial.print("\"fw_version\":\""); Serial.print(FW_VERSION); Serial.print("\",");
  Serial.print("\"temp\":"); Serial.print(temperature, 1);
  Serial.print(",\"ph\":"); Serial.print(phValue, 2);
  Serial.print(",\"tds\":"); Serial.print(tdsValue, 0);
  Serial.print(",\"level\":"); Serial.print(waterLevel, 1);
  Serial.println("}");
}

void updateDisplay() {
  oled.setCursor(0, 2);
  oled.print("Temp: "); 
  if(isnan(temperature)) oled.println("--.- C");
  else { oled.print(temperature, 1); oled.println(" C"); }
  oled.print("pH:   "); oled.println(phValue, 2);
  oled.print("TDS:  "); oled.print(tdsValue, 0); oled.println(" ppm");
  oled.print("Lev:  "); oled.print(waterLevel); oled.println(" %");
}

void readSerialCommand() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    
    if (input.startsWith("CONFIG:TANK:")) {
      int minIdx = input.indexOf("MIN:");
      int maxIdx = input.indexOf(",MAX:");
      if (minIdx > 0 && maxIdx > 0) {
        minDistance = input.substring(minIdx + 4, maxIdx).toFloat();
        maxDistance = input.substring(maxIdx + 5).toFloat();
        EEPROM.put(EEPROM_ADDR_MIN_DIST, minDistance);
        EEPROM.put(EEPROM_ADDR_MAX_DIST, maxDistance);
        EEPROM.commit();
        Serial.print("{\"msg\":\"Tank Config Updated\", \"min\":"); Serial.print(minDistance);
        Serial.print(", \"max\":"); Serial.print(maxDistance); Serial.println("}");
      }
    }
    
    if (input.startsWith("CONFIG:PH:")) {
        phOffset = input.substring(10).toFloat();
        EEPROM.put(EEPROM_ADDR_PH, phOffset);
        EEPROM.commit();
        Serial.print("{\"msg\":\"pH Config Updated\", \"val\":"); Serial.print(phOffset); Serial.println("}");
    }
    
    if (input.startsWith("CONFIG:TDS:")) {
        tdsKValue = input.substring(11).toFloat();
        EEPROM.put(EEPROM_ADDR_TDS_K, tdsKValue);
        EEPROM.commit();
        Serial.print("{\"msg\":\"TDS Config Updated\", \"val\":"); Serial.print(tdsKValue); Serial.println("}");
    }
    
    if (input.startsWith("CONFIG:TEMP:")) {
        tempOffset = input.substring(12).toFloat();
        EEPROM.put(EEPROM_ADDR_TEMP, tempOffset);
        EEPROM.commit();
        Serial.print("{\"msg\":\"Temp Config Updated\", \"val\":"); Serial.print(tempOffset); Serial.println("}");
    }
    
    if (input.startsWith("CAL:MODE:ON")) { calMode = true; Serial.println("{\"msg\":\"Calibration Mode ON\"}"); }
    if (input.startsWith("CAL:MODE:OFF")) { calMode = false; Serial.println("{\"msg\":\"Calibration Mode OFF\"}"); }
    
    if (input.startsWith("RESET:EEPROM")) {
        EEPROM.write(EEPROM_MAGIC, 0xFF);
        EEPROM.commit();
        Serial.println("{\"msg\":\"EEPROM reset. Reboot to apply defaults.\"}");
    }
  }
}
