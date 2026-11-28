import type {GameRendererProps} from './GameRenderer';
import {BACKGAMMON_GAME_ID} from './backgammonMatchPresentation';

export const CHECKERS_GAME_ID='04aad4ba-8cf6-4dd5-8d65-9dead4dab5ee';
export const CHESS_GAME_ID='5ceeb4a4-da2f-4218-884e-d485968d9c78';

export function fillsMatchLandscape(gameId:string|undefined,width:number,height:number) {
  return (gameId===CHESS_GAME_ID||gameId===BACKGAMMON_GAME_ID)&&width>height&&height<600;
}

const chessPresentation:NonNullable<GameRendererProps['boardPresentation']>={
  presentScene:(scene,message)=>{
    const strings=message.strings as Record<string,string>|undefined;
    return {...scene,labels:scene.labels?.filter(label=>label.id!=='title'),
      controls:scene.controls?.filter(control=>control.label!==(strings?.text_20||'Resign'))};
  },
  showSelectionFooter:false,
  motion:{animate_own:true},
};
const chessLandscapePresentation={...chessPresentation,visibleBoard:()=>true};
export const chessMatchPresentation=(landscape:boolean)=>landscape?chessLandscapePresentation:chessPresentation;

export const checkersMatchPresentation:NonNullable<GameRendererProps['boardPresentation']>={
  presentScene:scene=>({...scene,labels:[]}),
  showSelectionFooter:false,
};
