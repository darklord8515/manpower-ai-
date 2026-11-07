"""The AI layer: one model interface, the guards every model call passes through, and the run log.

Business rules and numbers stay in Python. A model only words things (the narrator) or chooses
among options Python has already checked (the Workforce agent), and everything it writes is
checked again before it is kept.
"""
