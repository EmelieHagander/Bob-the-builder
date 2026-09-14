from pathlib import Path

source = Path('scripts/apply-account-phase-summary-patch.py').read_text()
old = '''replace(path,
"              ))}",
"              })}",
count=1)'''
new = '''replace(path,
"                </div>\\n              ))}\\n            </div>\\n          )}",
"                </div>\\n              })}\\n            </div>\\n          )}")'''
if source.count(old) != 1:
    raise SystemExit('Could not locate the ambiguous project-card map closer in patch helper')
exec(compile(source.replace(old, new, 1), 'account-phase-summary-patch', 'exec'))
