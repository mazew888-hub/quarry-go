import pytest
from playwright.sync_api import sync_playwright
import serve

BASE = f'http://localhost:{serve.PORT}'

@pytest.fixture(scope='session')
def server():
    srv = serve.start(); yield BASE; srv.shutdown()

@pytest.fixture(scope='session')
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        yield b; b.close()

@pytest.fixture
def context(browser, server):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
    yield ctx; ctx.close()

@pytest.fixture
def page(context):
    pg = context.new_page(); pg.errors = []; pg.set_default_timeout(8000)
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    yield pg
    assert not pg.errors, pg.errors
