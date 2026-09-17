from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path('/mnt/data/streept-test')
css=(root/'frontend/src/components/NavigationView.css').read_text()
appcss=(root/'frontend/src/App.css').read_text()
html=f'''<!doctype html><html><head><meta charset="utf-8"><style>{appcss}\n{css}</style></head><body>
<div class="start-navigation-card" style="position:absolute;left:20px;top:20px;width:520px;padding:18px;border:1px solid #333;background:#111;box-sizing:border-box">
 <div class="start-navigation-actions">
  <button class="start-navigation-secondary">Route details</button>
  <button class="start-navigation-button" style="width:100%">➤ Enter navigation</button>
 </div>
</div>
<div class="trip-search" style="position:absolute"><div class="trip-search-fields" style="height:50px;background:#111"></div><div class="trip-search-results"><button class="trip-search-result">Sadar Flyover</button></div></div>
<div class="home-command-center">Home</div>
</body></html>'''
with sync_playwright() as p:
    b=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1680,'height':900})
    page.set_content(html)
    card=page.locator('.start-navigation-card').bounding_box()
    button=page.locator('.start-navigation-button').bounding_box()
    search=page.locator('.trip-search').evaluate('(e)=>getComputedStyle(e).zIndex')
    results=page.locator('.trip-search-results').evaluate('(e)=>getComputedStyle(e).zIndex')
    home=page.locator('.home-command-center').evaluate('(e)=>getComputedStyle(e).zIndex')
    assert button['x'] >= card['x'] and button['x']+button['width'] <= card['x']+card['width']+0.5, (card,button)
    assert int(results) > int(home), (results,home)
    print('CSS smoke PASS')
    print('card=',card)
    print('button=',button)
    print('z-index search=',search,'results=',results,'home=',home)
    b.close()
