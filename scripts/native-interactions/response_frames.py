"""Input to visible change on the app surface. Ignore system chrome and the iOS clock."""
import numpy as np


def response(times,images,start,point,screen):
    # Normalize recordings from different devices to the same evidence threshold.
    i=max((i for i,t in enumerate(times) if t<start),default=None)
    if i is None:raise ValueError('No frame before input')
    baseline=images[i].astype(np.int16)
    h,w=baseline.shape[:2];x,y=np.rint(np.array(point)/screen*[w,h]).astype(int)
    ry,rx=max(7,round(.035*h)),max(7,round(.065*w))
    button=np.s_[max(0,y-ry):min(h,y+ry+1),max(0,x-rx):min(w,x+rx+1)]
    def diff(image):
        change=np.max(np.abs(image.astype(np.int16)-baseline),axis=2)>25
        change[:int(.07*h)]=False;change[int(.97*h):]=False
        change[int(.072*h):int(.091*h),:int(.33*w)]=False
        return (float(change.mean()),float(change[button].mean()) if change[button].size else 0)
    prior=[diff(images[j]) for j in range(max(i-6,0),i) if start-times[j]<300]
    noise=np.max(prior,axis=0) if prior else (0,0)
    for j in range(i+1,len(times)):
        if times[j]<start:continue
        broad,near=diff(images[j])
        if broad>max(.0012,noise[0]+.0008) or near>max(.022,noise[1]+.012):
            return {'first_ms':round(times[j]-start,1),'frame_ms':round(times[j],2),'previous_frame_ms':round(times[j-1],2),
                    'screen_changed':round(broad,4),'near_input_changed':round(near,4)}
    return {'first_ms':None,'reason':'No visible change met the screen or touch-region threshold'}


def destination(times,images,start):
    """Time to the visible dialog or its dismissal, using the recorded final screen."""
    before=max((i for i,t in enumerate(times) if t<start),default=None)
    if before is None or len(images)<2:return None
    h,w=images[-1].shape[:2]
    region=np.s_[round(h*.11):round(h*.9),round(w*.06):round(w*.94)]
    first=images[before][region].astype(np.int16);last=images[-1][region].astype(np.int16)
    altered=np.max(abs(last-first),axis=2)>40
    if altered.mean()<.012:return None
    final=last[altered]
    for t,img in zip(times,images):
        if t<start:continue
        if np.mean(np.max(abs(img[region][altered].astype(np.int16)-final),axis=1)<35)>=.85:
            return round(t-start,1)
    return None
