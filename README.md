TerraScan

Road Health Monitoring System and Pothole Detection by Smart IoT.

Overview

TerraScan is a smart vehicle based on ESP32, it identifies potholes in real-time, dynamically changes the speed according to the severity of the road, and sends live data on the health of the roads to the cloud. The system shows how cheaper IoT devices could be used to make the roads safer and the infrastructure smarter to monitor.

Problem

Poor road conditions cause:

Vehicle damage

Increased accident risk

Traffic delays

The maintenance cost of infrastructure is high.

The existing systems of current monitoring are both extremely manual and slow.

Solution

TerraScan provides real time sensing and adaptive control to:

Measure potholes based on ultrasonic height change.

Categorize the degree of road severity.

Slow down automatically, according to severity.

Calculate dynamic road health score.

Monitor live data uploaded to Firebase.

How It Works

The ultrasonic sensor is a distance measuring sensor of the road surface.

The height of a starter-up calibration of a baseline road.

The difference in height is obtained:

heightChange
=
baseline
−
currentDistance
heightChange=baseline−currentDistance

Severity is mapped out of deviation thresholds.

The PWM speed is set depending on severity.

The computation of a road health score, 0-100 is done.

Information is transferred unhazardously to Firebase on a real-time basis.

Tech Stack
Hardware

ESP32

Ultrasonic sensor

L298N motor driver

DC geared motors

12V battery system

Software

C++ using Arduino framework

Python Flask backend

JavaScript web-based dashboard.

Cloud

Firebase Realtime Database

HTTPS REST communication

JSON data exchange

Features

Real time pothole detection

Adaptive speed control of motor.

Dynamic scoring on the road quality.

Cloud connected IoT system

Live monitoring dashboard

Challenges Faced

Motor torque drop at low PWM

Battery-ESP32 power allocation.

Firebase HTTPS communication security.

Selecting severity thresholds of realistic detection.

What We Learned

Embedded systems integration.

Calibration of real world sensors.

IoT cloud connectivity

Motor control using PWM

Secure data transmission

Time bound hardware software debugging.

Future Improvements

Location tagged road report GPS integration.

Severity classification by machine learning.

Multi vehicle deployment.

Dashboard of analytics of roads in the city.
