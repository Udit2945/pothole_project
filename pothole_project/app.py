import time
import threading
from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO

import firebase_admin
from firebase_admin import credentials, db


# =========================
# FLASK SETUP
# =========================

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")


# =========================
# FIREBASE SETUP
# =========================

cred = credentials.Certificate("firebase_key.json")

firebase_admin.initialize_app(cred, {
    "databaseURL": "https://pothole-data-3f291-default-rtdb.firebaseio.com/"
})


# =========================
# GLOBAL STATE
# =========================

mode = "hardware"
pothole_count = 0
last_severity = 0


# =========================
# FIREBASE REALTIME LISTENER
# =========================

def firebase_listener(event):
    if event.data is None:
        return

    # event.data is the new object pushed
    socketio.emit("update", event.data)
    print("Realtime push to UI")
    print("Firebase event received:", event.data)


# Attach listener to path
db.reference("roadData").listen(firebase_listener)


# =========================
# ROUTES
# =========================

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/set_mode", methods=["POST"])
def set_mode():
    global mode
    data = request.get_json()
    mode = data.get("mode", "hardware")
    print("MODE:", mode)
    return jsonify({"ok": True})


@app.route("/api/road-data", methods=["POST"])
def receive_data():
    global pothole_count, last_severity

    data = request.get_json(silent=True) or {}

    distance = float(data.get("distance", 0))
    speed = float(data.get("speed", 0))
    severity = int(data.get("severity", 0))
    roadScore = float(data.get("roadScore", 0))

    potholeEvent = False
    if severity > 0 and last_severity == 0:
        pothole_count += 1
        potholeEvent = True

    payload = {
        "distance": distance,
        "speed": speed,
        "severity": severity,
        "roadScore": roadScore,
        "potholes": pothole_count,
        "potholeEvent": potholeEvent,
        "timestamp": int(time.time() * 1000)
    }

    # Store in Firebase
    ref = db.reference("roadData")
    ref.push(payload)

    last_severity = severity

    return jsonify({"ok": True})


# =========================
# DEMO LOOP
# =========================

# def demo_loop():
#     import random
#     global pothole_count, last_severity

#     while True:
#         if mode == "demo":

#             severity = random.choice([0,0,0,1,0,2,0,3])
#             potholeEvent = False

#             if severity > 0 and last_severity == 0:
#                 pothole_count += 1
#                 potholeEvent = True

#             payload = {
#                 "distance": random.uniform(15, 30),
#                 "speed": random.randint(120, 170),
#                 "severity": severity,
#                 "roadScore": random.randint(60, 100),
#                 "potholes": pothole_count,
#                 "potholeEvent": potholeEvent,
#                 "timestamp": int(time.time() * 1000)
#             }

#             # Push to Firebase
#             ref = db.reference("roadData")
#             ref.push(payload)

#             last_severity = severity

#             time.sleep(0.5)

#         else:
#             time.sleep(0.2)
# print("DEMO DATA PUSHED")


# Start demo thread
# threading.Thread(target=demo_loop, daemon=True).start()


# =========================
# RUN SERVER
# =========================

if __name__ == "__main__":
    print("Server running on 0.0.0.0:5000")
    socketio.run(app, host="0.0.0.0", port=5000)