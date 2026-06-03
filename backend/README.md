---
title: Hoop Sync Backend
emoji: 🏀
colorFrom: purple
colorTo: orange
sdk: docker
app_port: 7860
pinned: false
---

# Hoop Sync – AI Basketball Analytics API

FastAPI backend powered by a custom-trained YOLOv11s model.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/upload` | Upload a video file |
| POST | `/process/{file_id}` | Start analysis |
| GET | `/status/{file_id}` | Poll processing status |
| POST | `/stop/{file_id}` | Cancel processing |
| GET | `/download/{file_id}` | Download annotated video |

## Notes

- Uploaded and processed files are auto-deleted after 30 minutes.
- The `model/best.pt` file must be tracked with Git LFS before pushing to this Space.
