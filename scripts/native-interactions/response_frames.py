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


def clock_alignment(times,images,points_width,points_height,touch):
    anchors=[]
    for t,im in zip(times,images):
        h,w=im.shape[:2]
        def color(x):return im[round(70*h/points_height),round(x*w/points_width),:3].astype(int)
        left,right=color(6),color(107)
        if not (left[0]>145 and left[1]<95 and left[2]>145 and right[0]<105 and min(right[1:])>145):continue
        word=sum((1<<i) for i in range(24) if np.mean(color(11+4*i))>127)
        if not anchors or word!=anchors[-1][2]:
            native=word+2**24*round((touch-word)/2**24)
            anchors.append((t,native-t,word))
    if len(anchors)<3:raise ValueError('Missing simulator clock stripe in video')
    offsets=np.array([a[1] for a in anchors]);center=float(np.median(offsets))
    return center, {'anchors':len(anchors),'median_offset_ms':center,
                    'p95_residual_ms':round(float(np.percentile(abs(offsets-center),95)),1)}
