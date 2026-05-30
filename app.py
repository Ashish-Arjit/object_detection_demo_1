import os
import cv2
import numpy as np
import base64
import uuid
import threading
from flask import Flask, request, jsonify, render_template, send_from_directory
from ultralytics import YOLO

app = Flask(__name__)

# Configurations
UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Global variables for model and video tasks
model = None
video_tasks = {}

def get_model():
    global model
    if model is None:
        model_path = os.path.join(app.root_path, 'yolo11n.pt')
        if not os.path.exists(model_path):
            # Fallback if model isn't in root (will download automatically)
            model_path = 'yolo11n.pt'
        model = YOLO(model_path)
    return model

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/classes', methods=['GET'])
def get_classes():
    try:
        yolo_model = get_model()
        # Get class names dictionary {id: name}
        names = yolo_model.names
        return jsonify({"success": True, "classes": names})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/detect-image', methods=['POST'])
def detect_image():
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({"success": False, "error": "No image data provided"}), 400
        
        # Parse image settings
        conf_threshold = float(data.get('conf', 0.25))
        iou_threshold = float(data.get('iou', 0.45))
        filter_classes = data.get('classes', []) # list of class IDs to filter
        
        # Decode base64 image
        img_data = data['image']
        if ',' in img_data:
            img_data = img_data.split(',')[1]
        
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"success": False, "error": "Invalid image data"}), 400
        
        # Get model and predict
        yolo_model = get_model()
        
        # If classes are specified, convert them to ints
        classes_filter = [int(c) for c in filter_classes] if filter_classes else None
        
        results = yolo_model.predict(
            source=img,
            conf=conf_threshold,
            iou=iou_threshold,
            classes=classes_filter,
            verbose=False
        )[0]
        
        # Process results
        detections = []
        h, w, _ = img.shape
        
        # Generate bounding boxes for output
        annotated_img = img.copy()
        
        # Box color palette mapping
        colors = {}
        
        for box in results.boxes:
            cls_id = int(box.cls[0].item())
            class_name = results.names[cls_id]
            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].tolist() # x1, y1, x2, y2
            
            # Generate random color for class if not exists
            if cls_id not in colors:
                # Harmonious colors matching our dashboard style
                np.random.seed(cls_id)
                colors[cls_id] = [int(c) for c in np.random.randint(50, 220, size=3)]
                
            color = colors[cls_id]
            x1, y1, x2, y2 = map(int, xyxy)
            
            # Save detection details
            detections.append({
                "class_id": cls_id,
                "class_name": class_name,
                "confidence": conf,
                "box": [x1, y1, x2, y2]
            })
            
            # Draw on image
            # Bounding box
            cv2.rectangle(annotated_img, (x1, y1), (x2, y2), color, 2)
            
            # Label background
            label = f"{class_name} {conf:.2f}"
            (w_label, h_label), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated_img, (x1, y1 - h_label - 10), (x1 + w_label + 10, y1), color, -1)
            
            # Text label
            # text color: white or black depending on brightness
            text_color = (255, 255, 255)
            cv2.putText(annotated_img, label, (x1 + 5, y1 - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, text_color, 1, cv2.LINE_AA)
            
        # Encode annotated image back to base64
        _, buffer = cv2.imencode('.jpg', annotated_img)
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            "success": True,
            "detections": detections,
            "image": f"data:image/jpeg;base64,{annotated_base64}",
            "summary": {name: sum(1 for d in detections if d["class_name"] == name) for name in set(d["class_name"] for d in detections)}
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/detect-frame', methods=['POST'])
def detect_frame():
    """Optimized for real-time webcam streams. Returns only coordinates & counts (no drawing on server)"""
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({"success": False, "error": "No image data provided"}), 400
        
        conf_threshold = float(data.get('conf', 0.25))
        filter_classes = data.get('classes', [])
        
        img_data = data['image']
        if ',' in img_data:
            img_data = img_data.split(',')[1]
            
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"success": False, "error": "Invalid frame"}), 400
            
        yolo_model = get_model()
        classes_filter = [int(c) for c in filter_classes] if filter_classes else None
        
        results = yolo_model.predict(
            source=img,
            conf=conf_threshold,
            classes=classes_filter,
            verbose=False
        )[0]
        
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0].item())
            class_name = results.names[cls_id]
            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].tolist() # x1, y1, x2, y2
            
            detections.append({
                "class_id": cls_id,
                "class_name": class_name,
                "confidence": conf,
                "box": [round(c, 1) for c in xyxy]
            })
            
        return jsonify({
            "success": True,
            "detections": detections,
            "summary": {name: sum(1 for d in detections if d["class_name"] == name) for name in set(d["class_name"] for d in detections)}
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def process_video_async(task_id, filepath, conf_threshold, iou_threshold, filter_classes):
    global video_tasks
    try:
        yolo_model = get_model()
        cap = cv2.VideoCapture(filepath)
        
        if not cap.isOpened():
            video_tasks[task_id] = {"status": "error", "error": "Cannot open video file"}
            return
            
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        
        # Output filename
        out_filename = f"processed_{task_id}.mp4"
        out_path = os.path.join(app.config['UPLOAD_FOLDER'], out_filename)
        
        # We use mp4v codec for wide compatibility in windows/web download.
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(out_path, fourcc, fps, (width, height))
        
        frame_idx = 0
        classes_filter = [int(c) for c in filter_classes] if filter_classes else None
        
        colors = {}
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            # Perform prediction per frame
            results = yolo_model.predict(
                source=frame,
                conf=conf_threshold,
                iou=iou_threshold,
                classes=classes_filter,
                verbose=False
            )[0]
            
            # Draw boxes on frame
            for box in results.boxes:
                cls_id = int(box.cls[0].item())
                class_name = results.names[cls_id]
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].tolist()
                
                if cls_id not in colors:
                    np.random.seed(cls_id)
                    colors[cls_id] = [int(c) for c in np.random.randint(50, 220, size=3)]
                
                color = colors[cls_id]
                x1, y1, x2, y2 = map(int, xyxy)
                
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                label = f"{class_name} {conf:.2f}"
                (w_label, h_label), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                cv2.rectangle(frame, (x1, y1 - h_label - 10), (x1 + w_label + 10, y1), color, -1)
                cv2.putText(frame, label, (x1 + 5, y1 - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
                
            out.write(frame)
            frame_idx += 1
            
            # Update progress status
            video_tasks[task_id] = {
                "status": "processing",
                "progress": round((frame_idx / total_frames) * 100, 1),
                "current_frame": frame_idx,
                "total_frames": total_frames
            }
            
        cap.release()
        out.release()
        
        # Complete task status
        video_tasks[task_id] = {
            "status": "completed",
            "progress": 100.0,
            "filename": out_filename,
            "url": f"/static/uploads/{out_filename}"
        }
        
    except Exception as e:
        video_tasks[task_id] = {"status": "error", "error": str(e)}

@app.route('/api/detect-video', methods=['POST'])
def detect_video():
    try:
        if 'video' not in request.files:
            return jsonify({"success": False, "error": "No video file provided"}), 400
            
        file = request.files['video']
        if file.filename == '':
            return jsonify({"success": False, "error": "No file selected"}), 400
            
        conf_threshold = float(request.form.get('conf', 0.25))
        iou_threshold = float(request.form.get('iou', 0.45))
        filter_classes = request.form.getlist('classes')
        
        # Save source video file
        task_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1]
        temp_filename = f"source_{task_id}{ext}"
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], temp_filename)
        file.save(temp_path)
        
        # Initialize task status
        video_tasks[task_id] = {
            "status": "processing",
            "progress": 0.0,
            "current_frame": 0,
            "total_frames": 100
        }
        
        # Start async thread for frame-by-frame processing
        t = threading.Thread(
            target=process_video_async, 
            args=(task_id, temp_path, conf_threshold, iou_threshold, filter_classes)
        )
        t.daemon = True
        t.start()
        
        return jsonify({
            "success": True,
            "task_id": task_id
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/video-status/<task_id>', methods=['GET'])
def get_video_status(task_id):
    if task_id not in video_tasks:
        return jsonify({"success": False, "error": "Task not found"}), 404
    return jsonify({"success": True, "task": video_tasks[task_id]})

if __name__ == '__main__':
    # Run server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)
