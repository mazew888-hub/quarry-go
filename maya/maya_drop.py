# -*- coding: utf-8 -*-
# QUARRY FEEDBACK FOR MAYA
#
# Drop this file into Maya's viewport. It puts the reviewed frames (with the
# drawn notes) on the camera you're looking through as an image-plane
# sequence, frame 1 on the first frame of your playback range.
#
# - The pictures are packed inside this file. They're unpacked once into your
#   Maya project's images folder (images/quarry_feedback/...), so the image
#   plane still works when you reopen the scene.
# - Dropping it again (or another version of the same shot) replaces that
#   shot's image plane instead of adding another.
# - To take it off, delete the image plane (quarryFeedback_...) or run
#   remove() from this file in the Script Editor.
#
# Made by Quarry. Nothing is sent anywhere.
#
# (This header and the code below are the template Quarry fills in: it
# writes SHOT, STAMP, FPS, DIGITS, EXT, STILL, ALPHA and the frames after it.
# A picture from the Library comes as one still image plane, STILL = True.
# ALPHA = True: just the drawings, see-through PNGs, shown at full strength
# in front of the scene so they sit over the animation.)
from __future__ import print_function

import base64
import os
import re

SHOT = "shot"  # QUARRY:SHOT
STAMP = "0"  # QUARRY:STAMP
FPS = 24.0  # QUARRY:FPS
DIGITS = 4  # QUARRY:DIGITS
EXT = "jpg"  # QUARRY:EXT
STILL = False  # QUARRY:STILL
ALPHA = False  # QUARRY:ALPHA
PREFIX = "quarryFeedback_"


def plane_name(shot=None):
    safe = re.sub(r"[^A-Za-z0-9_]", "_", shot or SHOT).strip("_") or "shot"
    if safe[0].isdigit():
        safe = "_" + safe
    return PREFIX + safe


def frames_folder():
    """<project>/images/quarry_feedback/<shot>_<stamp> (one per export)."""
    import maya.cmds as cmds
    root = cmds.workspace(query=True, rootDirectory=True) or os.path.expanduser("~")
    images = cmds.workspace(fileRuleEntry="images") or "images"
    base = images if os.path.isabs(images) else os.path.join(root, images)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", SHOT).strip("_") or "shot"
    return os.path.normpath(os.path.join(base, "quarry_feedback", "%s_%s" % (safe, STAMP)))


def unpack(folder=None):
    """Writes the frames (once). Returns (first frame's path, count)."""
    folder = folder or frames_folder()
    if not os.path.isdir(folder):
        os.makedirs(folder)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", SHOT).strip("_") or "shot"
    first = None
    for i, data in enumerate(_FRAMES):
        path = os.path.join(folder, ("%s.%s" % (safe, EXT)) if STILL else ("%s.%0*d.%s" % (safe, DIGITS, i + 1, EXT)))
        if first is None:
            first = path
        if not os.path.isfile(path):
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(base64.b64decode(data))
            os.rename(tmp, path)
    return first, len(_FRAMES)


def _model_panel(p):
    import maya.cmds as cmds
    try:
        return bool(p) and cmds.getPanel(typeOf=p) == "modelPanel"
    except Exception:  # a panel that's gone
        return False


def viewport_camera(panel=None):
    """The camera of [panel] (the viewport the file was dropped on), else of
    the viewport you last clicked in, else of the first one showing."""
    import maya.cmds as cmds
    if not _model_panel(panel):
        panel = cmds.getPanel(withFocus=True)
    if not _model_panel(panel):
        vis = [p for p in (cmds.getPanel(visiblePanels=True) or []) if _model_panel(p)]
        panel = vis[0] if vis else None
    if not panel:
        raise RuntimeError("No viewport is open to put the feedback on.")
    cam = cmds.modelPanel(panel, query=True, camera=True)
    if cmds.nodeType(cam) == "camera":
        return cam
    return (cmds.listRelatives(cam, shapes=True, type="camera") or [cam])[0]


def remove(shot=None):
    """Deletes Quarry feedback image planes (only [shot]'s when given)."""
    import maya.cmds as cmds
    want = plane_name(shot) if shot else None
    gone = 0
    for shape in cmds.ls(type="imagePlane") or []:
        t = (cmds.listRelatives(shape, parent=True) or [shape])[0]
        n = t.rsplit("|", 1)[-1]
        if (want and re.match(re.escape(want) + r"\d*$", n)) or (not want and n.startswith(PREFIX)):
            cmds.delete(t)
            gone += 1
    return gone


def load(start_frame=None, see_through=True, panel=None):
    """Unpacks the frames and makes the image plane on the camera of [panel]
    (else the viewport you last clicked in)."""
    import maya.cmds as cmds
    cam = viewport_camera(panel)
    first, count = unpack()
    if start_frame is None:
        start_frame = cmds.playbackOptions(query=True, minTime=True)
    cmds.undoInfo(openChunk=True, chunkName="Quarry feedback")
    try:
        remove(SHOT)
        made = cmds.imagePlane(camera=cam, fileName=first.replace("\\", "/"), name=plane_name())
        xform, shape = made[0], made[1]
        if not STILL:
            cmds.setAttr(shape + ".useFrameExtension", 1)
            # Maya shows picture (frame + offset): the start frame shows picture 1.
            cmds.setAttr(shape + ".frameOffset", int(round(1 - start_frame)))
        cmds.setAttr(shape + ".displayOnlyIfCurrent", 1)
        cmds.setAttr(shape + ".fit", 1)  # best fit in the film gate, no stretching
        if ALPHA:
            # The drawings only: their own transparency, at full strength,
            # in front of everything.
            near = cmds.getAttr(cam + ".nearClipPlane")
            cmds.setAttr(shape + ".depth", max(near * 1.5, 0.11))
            cmds.setAttr(shape + ".displayMode", 3)  # RGBA: the see-through parts stay see-through
            cmds.setAttr(shape + ".alphaGain", 1.0)
        elif see_through:
            near = cmds.getAttr(cam + ".nearClipPlane")
            cmds.setAttr(shape + ".depth", max(near * 1.5, 0.11))
            cmds.setAttr(shape + ".alphaGain", 0.6)
    finally:
        cmds.undoInfo(closeChunk=True)
    cam_name = (cmds.listRelatives(cam, parent=True) or [cam])[0]
    if STILL:
        note = "Quarry: %s on %s" % (SHOT, cam_name)
    else:
        end = start_frame + count - 1
        lo = cmds.playbackOptions(query=True, minTime=True)
        hi = cmds.playbackOptions(query=True, maxTime=True)
        note = "Quarry feedback: %d frames of %s on %s, frames %g-%g" % (count, SHOT, cam_name, start_frame, end)
        if (lo, hi) != (start_frame, end):
            note += " (your playback range is %g-%g)" % (lo, hi)
    print(note + ".\nFrames: " + os.path.dirname(first))
    try:
        cmds.inViewMessage(assistMessage=note, position="topCenter", fade=True, fadeStayTime=4000)
    except Exception:  # an older Maya without in-view messages: the print above says it
        pass
    return shape


def _newest():
    """This file as it is on disk now. Maya keeps a dropped file in memory for
    the session, and a newer export of the same shot has the same name: when
    the file on disk is a different export (its STAMP), reload it so its
    frames are the ones that go in."""
    import sys
    me = sys.modules.get(__name__)
    path = globals().get("__file__")
    if me is None or not path or not os.path.isfile(path):
        return me
    with open(path, encoding="utf-8") as f:
        for _ in range(80):
            line = f.readline()
            m = re.match(r'^STAMP = (.*?)\s*# QUARRY:STAMP', line)
            if m:
                if m.group(1).strip() != repr(STAMP):
                    # Run the file again into this same module.
                    import importlib.util
                    spec = importlib.util.spec_from_file_location(__name__, path)
                    spec.loader.exec_module(me)
                    return me
                break
    return me


def onMayaDroppedPythonFile(*args):
    """Maya calls this when the file is dropped into the viewport."""
    import maya.cmds as cmds
    # The viewport the file was let go over: the one under the mouse now
    # (the one last clicked can be another, in a two-viewport layout).
    try:
        dropped_on = cmds.getPanel(underPointer=True)
    except Exception:
        dropped_on = None
    try:
        mod = _newest()
        (mod.load if mod is not None else load)(panel=dropped_on)
    except Exception as e:
        cmds.warning("Quarry feedback couldn't load: %s" % e)
        raise


# The frames, packed (JPG, base64), one string per frame, frame 1 first.
_FRAMES = []
