"""Secure terminal bootstrap: read credentials from process variables, never log them."""
import json, os, sys, urllib.request
base=sys.argv[1].rstrip('/')
if not (base.startswith('https://') or base in ['http://127.0.0.1:8787','http://localhost:8787']):
 raise SystemExit('HTTPS required outside localhost')
request=urllib.request.Request(base+'/api/v1/admin/bootstrap',data=json.dumps({'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']}).encode(),headers={'Content-Type':'application/json','Origin':base,'Authorization':'Bearer '+os.environ['BOOTSTRAP_TOKEN']},method='POST')
with urllib.request.urlopen(request,timeout=30) as response: print('Bootstrap HTTP',response.status)
