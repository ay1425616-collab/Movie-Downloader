"""Run against a clean local seeded instance with bootstrap disabled."""
import urllib.request, urllib.error, json, re, os
base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:8787')
def get(path):
 with urllib.request.urlopen(base+path,timeout=15) as response:
  return response.status,response.read().decode()
status,html=get('/the-last-lighthouse-demo.html')
assert status==200 and '<title>The Last Lighthouse' in html
assert 'No authorized files are currently available.' in html
structured=re.search(r'<script type="application/ld\+json">(.*?)</script>',html)
assert json.loads(structured.group(1))['@graph'][0]['@type']=='Movie'
status,admin=get('/admin')
assert status==200 and 'id="root"' in admin
for asset in re.findall(r'(?:src|href)="(/assets/[^"]+)"',admin):
 assert get(asset)[0]==200
request=urllib.request.Request(base+'/api/v1/admin/bootstrap',data=b'{}',headers={'Origin':base,'Content-Type':'application/json'},method='POST')
try:
 urllib.request.urlopen(request)
 raise AssertionError('Bootstrap unexpectedly enabled')
except urllib.error.HTTPError as error:
 assert error.code==403
catalog=json.loads(get('/api/v1/movies')[1])
assert len(catalog['data'])==1 and catalog['data'][0]['id']=='demo'
print('SSR, JSON-LD, admin assets, disabled bootstrap and clean demo catalog smoke checks passed')
