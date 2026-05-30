# 🌌 Aether Vision - YOLOv11 Object Detection Dashboard

Aether Vision is a premium, real-time object detection web application featuring a stunning glassmorphic dark-theme dashboard. Powered by a **Flask (Python)** backend and the cutting-edge **YOLOv11** deep learning model, the dashboard offers image analysis, video processing, live webcam feeds, and visual telemetry charts.

---

## ✨ Core Features

*   **📊 Telemetry Dashboard**: Real-time stats counting total detections, average inference latency (ms), webcam render frame rates (FPS), and session class distributions visualized via interactive bar charts (Chart.js).
*   **🖼️ Image Studio**:
    *   Drag-and-drop or file selector uploader.
    *   Interactive **Split-Screen Comparative Slider** showing original vs. detected results.
    *   Dynamic detections table with confidence scores.
    *   **Crop View modal**: Instantly extract cropped images of any detected object using client-side canvas extraction without querying the server again.
    *   Floating **Remove Image** button to reset the uploader state and analyze a new photo instantly.
*   **🎥 Webcam Live Stream**:
    *   Uses HTML5 WebRTC to stream camera frames.
    *   Performs inference on the backend and overlay-renders colored bounding boxes and labels locally on canvas.
    *   **Fallback Option**: If no camera hardware is detected, the UI adapts dynamically and prompts the user to upload photos directly to the Image Studio.
*   **🎞️ Video Lab**: Upload MP4, AVI, or MOV video files up to 50MB and process them frame-by-frame on a background worker thread. Includes a running progress bar and download options.

---

## 🛠️ Technology Stack

*   **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphism & Neon Shadows), Javascript (ES6), [Chart.js](https://www.chartjs.org/) (Data Visualizations), [FontAwesome](https://fontawesome.com/) (Vector Icons).
*   **Backend**: Python 3.12, [Flask](https://flask.palletsprojects.com/) (Web Framework), [OpenCV](https://opencv.org/) (Image and Video processing), [Ultralytics YOLOv11](https://github.com/ultralytics/ultralytics) (Object Detection Inference Engine).

---

## 📁 Repository Structure

```text
├── app.py                  # Flask backend server & YOLO endpoint routing
├── requirements.txt        # Python dependency list
├── yolo11n.pt              # YOLO11 Nano pre-trained weights (~5.6MB)
├── .gitignore              # Excludes virtual environments and temp uploads
├── README.md               # Project documentation
├── templates/
│   └── index.html          # Frontend dashboard HTML layout
└── static/
    ├── css/
    │   └── style.css       # Premium glassmorphic styling sheet
    └── js/
        └── app.js          # Tab navigation, webcam stream loops, and charts controller
```

---

## 🚀 Getting Started (Run Locally)

### Prerequisites
Make sure you have **Python 3.12+** and **Git** installed on your system.

### 1. Clone the repository
```bash
git clone https://github.com/Ashish-Arjit/object_detection_demo_1.git
cd object_detection_demo_1
```

### 2. Setup Virtual Environment & Install Dependencies
Create a virtual environment to isolate the project packages:
```bash
# Create venv
python -m venv venv

# Activate venv (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Activate venv (Mac/Linux Bash)
source venv/bin/activate

# Install required packages
pip install -r requirements.txt
```

### 3. Run the Server
```bash
python app.py
```
Open your browser and navigate to: **`http://localhost:5000`**

---

## 🔌 API Endpoints Documentation

*   `GET /api/classes`
    *   **Description**: Retrieves the dictionary mapping class IDs to class names (80 COCO classes).
*   `POST /api/detect-image`
    *   **Payload**: `{"image": "data:image/jpeg;base64,...", "conf": 0.25, "iou": 0.45, "classes": []}`
    *   **Response**: Returns the base64-encoded annotated image, detections breakdown array, and counts.
*   `POST /api/detect-frame`
    *   **Description**: High-speed, lightweight endpoint for real-time webcam streams. Returns only raw coordinate boxes and class counts (no image re-encoding to save bandwidth).
*   `POST /api/detect-video`
    *   **Description**: Accepts a video file in multipart form, generates a task ID, and kicks off asynchronous processing.
*   `GET /api/video-status/<task_id>`
    *   **Description**: Retrieves progress percentages and URLs for completed video tasks.

---

## ☁️ Deployment Notes

This application contains a **Python backend**. It cannot be hosted statically (like on GitHub Pages). 

To deploy it online for free, use a provider that supports Python runtimes:
1.  **Hugging Face Spaces (Docker/Python)**: Highly recommended. Create a Space, upload the code files, and build.
2.  **Render.com**: Connect your GitHub repo, select the Python runtime, set build command `pip install -r requirements.txt`, and start command `python app.py`.

---

## 📄 License
This project is open-source and available under the [MIT License](https://opensource.org/licenses/MIT).
