#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <WiFiClientSecure.h>

// ====== L298N + ESP32 pins ======
#define IN1 26
#define IN2 27
#define IN3 14
#define IN4 12
#define ENA 25
#define ENB 33

void sendToFirebase(float distance, int speed, int severity, int roadScore)
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();  // skip certificate validation (ok for demo)

  HTTPClient http;

  String url = String(FIREBASE_HOST) + "/roadData.json";

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"distance\":" + String(distance,2) + ",";
  json += "\"speed\":" + String(speed) + ",";
  json += "\"severity\":" + String(severity) + ",";
  json += "\"roadScore\":" + String(roadScore);
  json += "}";

  int code = http.POST(json);

  Serial.print("Firebase HTTP Code: ");
  Serial.println(code);

  if (code > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(code));
  }
  Serial.print("Firebase URL: ");
  Serial.println(url);
  http.end();
}

// ====== Ultrasonic pins ======
#define TRIG_PIN 5
#define ECHO_PIN 18

// ====== PWM settings ======
#define PWM_FREQ 1000
#define PWM_RESOLUTION 8
#define CH_LEFT 0
#define CH_RIGHT 1

// ====== Baseline calibration ======
const unsigned long CALIB_MS = 2000; // 2s baseline learn
float baseline_cm = 0.0;
bool baseline_ready = false;

// ====== Filtering ======
float dist_filt = 0.0;
const float ALPHA = 0.85;

// ====== Last printed for serial & server (based on REPORTED values) ======
int lastPrintedSeverity = -1;
int lastPrintedRoadScore = -1;

// ====== Reporting based on SPEED (not sensor) ======
const int PWM_FAST = 170;        // "good pace" PWM (speedFromSeverity(0))
float roadScoreReported = 100.0; // continuous float score (we send rounded int)
unsigned long lastScoreMs = 0;   // kept for compatibility (not strictly needed)

// ====== Utility: read ultrasonic distance in cm ======
float readDistanceCM()
{
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout
  if (duration == 0) return 0.0;
  return (duration * 0.0343f) / 2.0f;
}

// ====== Motor control ======
void setForward()
{
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
}

void setSpeedPWM(int pwm)
{
  pwm = constrain(pwm, 0, 255);
  ledcWrite(CH_LEFT, pwm);
  ledcWrite(CH_RIGHT, pwm);
}

// ====== Sensor severity & speed mapping (UNCHANGED behavior) ======
int severityFromRaised(float heightChangeCm)
{
  if (heightChangeCm < 0.5) return 0;
  else if (heightChangeCm < 1.5) return 1;
  else if (heightChangeCm < 3.0) return 2;
  else return 3;
}

int speedFromSeverity(int sev)
{
  switch (sev)
  {
    case 0: return 170;
    case 1: return 140;
    case 2: return 110;
    case 3: return 70;
    default: return 170;
  }
}

// ====== REPORTED severity derived from PWM (for DISPLAY/LOGGING only) ======
int severityFromPWM(int pwm) {
  int delta = PWM_FAST - pwm; // 0 = fast, bigger = slower

  if (delta <= 5)  return 0;
  if (delta <= 30) return 1;
  if (delta <= 60) return 2;
  return 3;
}

// ====== REPORTED roadScore derived from PWM (recovers when speeding up) ======
int updateRoadScoreFromPWM(int pwm) {
  // Normalize speed 0..1 relative to "fast"
  float speedNorm = (float)pwm / (float)PWM_FAST;
  if (speedNorm > 1.0f) speedNorm = 1.0f;
  if (speedNorm < 0.0f) speedNorm = 0.0f;

  // Target score depends on speed (0..100)
  float target = 100.0f * speedNorm;

  // Drop quickly when slowing, recover faster when speeding up
  float k_up = 0.20f;    // recovery speed
  float k_down = 0.35f;  // drop speed

  float k = (target > roadScoreReported) ? k_up : k_down;
  roadScoreReported = (1.0f - k) * roadScoreReported + k * target;

  // Clamp
  if (roadScoreReported > 100) roadScoreReported = 100;
  if (roadScoreReported < 0)   roadScoreReported = 0;

  // Rounded int so small increases show up
  return (int)(roadScoreReported + 0.5f);
}

// ====== Setup ======
void setup()
{
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);

  // Motor pins
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  // PWM
  ledcSetup(CH_LEFT, PWM_FREQ, PWM_RESOLUTION);
  ledcSetup(CH_RIGHT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(ENA, CH_LEFT);
  ledcAttachPin(ENB, CH_RIGHT);

  // Ultrasonic pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  setForward();
  setSpeedPWM(140);

  // Connect to phone hotspot
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Hotspot");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to Hotspot!");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

// ====== Main loop ======
void loop()
{
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(200);
    return;
  }

  unsigned long now = millis();

  // Read distance
  float d = readDistanceCM();
  if (d <= 0.1) d = dist_filt > 0 ? dist_filt : 0.0;

  // Filter
  if (dist_filt == 0.0) dist_filt = d;
  dist_filt = (1.0 - ALPHA) * dist_filt + ALPHA * d;

  // Baseline calibration (first 2s)
  static unsigned long calibStart = 0;
  static int calibCount = 0;
  static float calibSum = 0.0;

  if (!baseline_ready)
  {
    if (calibStart == 0) calibStart = now;
    calibSum += dist_filt;
    calibCount++;

    if (now - calibStart >= CALIB_MS)
    {
      baseline_cm = calibSum / max(calibCount, 1);
      baseline_ready = true;
    }

    setSpeedPWM(110);

    // CSV for monitoring: distance,speed,severity,roadScore
    Serial.print(dist_filt, 2);
    Serial.print(",");
    Serial.print(110);
    Serial.print(",");
    Serial.print(-1);
    Serial.print(",");
    Serial.println(100);

    delay(50);
    return;
  }

  // ===== SENSOR LOGIC (UNCHANGED) =====
  float heightChange = baseline_cm - dist_filt;
  if (heightChange < 0) heightChange = 0;

  int sevSensor = severityFromRaised(heightChange); // sensor-severity
  int pwm = speedFromSeverity(sevSensor);          // speed control from sensor severity

  // Apply speed (UNCHANGED behavior)
  setForward();
  setSpeedPWM(pwm);

  // ===== REPORTED severity + score based on PWM =====
  int sevReported = severityFromPWM(pwm);
  int roadScoreInt = updateRoadScoreFromPWM(pwm);

  // Print and send when REPORTED severity or score changes
  if (sevReported != lastPrintedSeverity || roadScoreInt != lastPrintedRoadScore)
  {
    Serial.print("Severity changed to: ");
    Serial.print(sevReported);
    Serial.print(" | RoadScore: ");
    Serial.println(roadScoreInt);

    sendToFirebase(d, pwm, sevReported, roadScoreInt);

    lastPrintedSeverity = sevReported;
    lastPrintedRoadScore = roadScoreInt;
  }

  delay(60); // ~16 Hz updates
}