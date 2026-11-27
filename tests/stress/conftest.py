# The same server and browser fixtures as the e2e tests.
import sys, pathlib, importlib.util
E2E = pathlib.Path(__file__).resolve().parents[1] / 'e2e'
sys.path.insert(0, str(E2E))
_spec = importlib.util.spec_from_file_location('e2e_conftest', E2E / 'conftest.py')
_m = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_m)
server, browser, context, page = _m.server, _m.browser, _m.context, _m.page
