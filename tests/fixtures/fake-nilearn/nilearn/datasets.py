import numpy as np

LABELS = [b"Unknown", b"S_calcarine", b"G_cuneus", b"G_temp_sup-G_T_transv", b"G_precuneus"]


def fetch_atlas_surf_destrieux():
    # 10242 vertices per fsaverage5 hemisphere, labelled in contiguous blocks.
    hemisphere = np.repeat(np.arange(len(LABELS)), int(np.ceil(10242 / len(LABELS))))[:10242]
    return {"labels": LABELS, "map_left": hemisphere, "map_right": hemisphere.copy()}
