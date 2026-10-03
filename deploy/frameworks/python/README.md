# Python
`flask_app.py` and `fastapi_app.py` are complete servers (`pip install -r requirements.txt`), started and
validated in CI. They serve `data/sustainability-data.json` beside the recipe, or the file named by `SD_FILE`.
Flask's built-in server is for trying the recipe; in production run it under a WSGI server (gunicorn, waitress). `django_views.py` is the view plus the one `urls.py` line; Django's own 405 handling
supplies `Allow`. A fuller Python example with security safeguards is `../../../example-scripts/request-handler.py`.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
