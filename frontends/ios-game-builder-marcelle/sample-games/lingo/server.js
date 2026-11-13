"use strict";

// Lingo, after the 2002 version of the TV game show (en.wikipedia.org/wiki/Lingo_(American_game_show)).
// Two teams: 2 players (one each) or 4 (seats 0 and 2 against 1 and 3; partners take turns guessing).
// A five-letter mystery word shows its first letter. The team in control has five guesses; each
// guess lights its letters: red = right letter in the right place, yellow = in the word but in
// another place. An invalid guess (not a five-letter word in the list) or a fifth wrong guess passes
// control: the other team sees one more letter (unless that would show the whole word) and gets one
// guess; if it also fails the word is discarded. A correct word is worth 25 points and lets the
// team draw two balls from its hopper: a numbered ball covers that number on the team's Lingo card,
// a red "stopper" ends the draw. Five covered in a row, column or diagonal is a Lingo: 50 points and
// a new card. Each card starts with ten numbers covered. Round 2 doubles every score and adds three
// "?" balls that cover any open number. The team with the most points at the end wins.
// Choices where the page is silent: 5 words per round; 3 stoppers per hopper; word starts alternate
// between the teams; the stealing team gets one guess; no 5-second timer (turn-based); cards use
// columns 1-10, 11-20, ... 41-50 with odd numbers for the first team and even for the second; a
// "?" ball covers the open number that best completes a line; a tie at the end is shared.
//
// Words: SCOWL (http://wordlist.aspell.net/), five-letter lowercase words. Mystery words come from
// sizes 10-20 (common words); guesses may be any word from sizes 10-35. Copyright 2000-2018 by Kevin
// Atkinson. Permission to use, copy, modify, distribute and sell these word lists, the associated
// scripts, the output created from the scripts, and its documentation for any purpose is hereby
// granted without fee, provided that the above copyright notice appears in all copies and that both
// that copyright notice and this permission notice appear in supporting documentation. Kevin
// Atkinson makes no representations about the suitability of this array for any purpose. It is
// provided "as is" without express or implied warranty. (Lists written by wordlist.py.)

const ANSWERS = "abideabortaboutaboveabuseacornactedactoracuteadaptaddedadmitadoptadultafteragainagentagingagonyagreeaheadaidedaimedalarmalbumalertaliasalienalignalikealiveallowalonealongaloudalphaalteramazeamberamendamongampleamuseangelangerangleangryannoyapartappleapplyareasarenaarguearisearmedarosearrayarrowashesasideaskedassetatlasatomsaudioavoidawaitawakeawardawareawfulaxiombacksbadgebadlybakedbakesballsbanalbandsbanksbarksbasedbasesbasicbasisbatchbathsbeachbeansbeardbearsbeastbeatsbeersbeganbeginbegunbeingbellsbelowbenchbendsbiblebigotbillsbindsbirdsbirthbitesblackbladeblameblankblastblessblindblinkblissblockbloodblownblowsbluesblurbboardboatsbogusboilsbombsbonesbonusbooksboostbootsboredboresborneboundboxesbrainbrakebrandbrassbravebreadbreakbreedbrickbriefbringbroadbrokebrownbrushbucksbuildbuiltbulbsbunchburnsburntburstbusesbuyerbytescablecakescallscampscardscaredcarescarrycasedcasescastscatchcatercauseceasecellschainchairchalkchaoschapscharmcharschartchasechatscheapcheatcheckcheekcheerchesschestchewschiefchildchipschoirchopschordchosechuckchunkcidercircacitedcitescivilclaimclashclasscleanclearclickcliffclimbclipsclockclonecloseclothcloudclubscluescoachcoastcoatscodedcodescoinscoloncolorcomescomiccommacookscoolscopedcopescostscoughcouldcountcourtcovercrackcraftcrampcrashcrasscrawlcrazycreamcreedcreepcriedcriescrimecrispcropscrosscrowdcrowncrudecruelcrushcubiccuredcurescurlycurrycursecurvecyclecynicdailydamnsdancedareddaresdateddatesdatumdealsdealtdeathdebugdecaydeedsdeemsdeitydelaydeltadensedepthdeterdevildialsdiarydigitdineddinerdinesdirtydiscodiscsditchdittodiveddivesdodgedogmadoingdoomsdoorsdosesdoubtdozendraftdragsdraindramadrankdrawndrawsdreaddreamdressdrieddriesdriftdrilldrinkdripsdrivedropsdrovedrowndrugsdrumsdrunkducksdummydumpsdustydyingeagereagleearlyearnseartheateneateredgeseditseightelecteliteembedemptyendedenemyenjoyenterentryequalequiperaseerroressayethicevenseventeveryevilsexactexamsexistexitsextrafacedfacesfactsfailsfaintfairyfaithfallsfalsefancyfarcefatalfaultfavorfearsfeedsfeelsfencefetchfeverfewerfiberfieldfifthfiftyfightfiledfilesfillsfilmsfinalfindsfinedfinerfinesfiredfiresfirmsfirstfiverfixedfixesfizzyflagsflameflashflawsfleetfleshfliedfliesflipsfloatfloodfloorflourflownflowsfluidflushflutefocusfoldsfolksfontsfoodsfoolsforceformsforthfortyforumfoundframefrankfraudfreakfreedfreesfreshfriedfriesfrogsfrontfrownfrozefruitfudgefullyfumesfundsfunnyfurryfussyfuzzygainsgamesgatesgearsgenesgenreghostgiantgiftsgirlsgivengivesglassgleanglorygloveglowsgnomegoalsgoinggoodsgoodygrabsgracegradegraingrandgrantgraphgraspgrassgravegreatgreedgreengriefgrindgripsgroangrossgroupgrowngrowsguardguessguestguideguilthabithackshairshairyhallshaltshalvehandshandyhangshappyhardyharshhastyhatedhateshavocheadsheardhearsheartheatsheavyheelshellohelpshencehidedhideshillshintshiredhireshobbyholdsholeshomeshoneyhonorhookshopedhopeshordehorsehostshotelhourshousehumanhumorhuntshurryhurtsiconsidealideasidiomidiotimageimplyinaneincurindexinferinnerinputinterirateironyissueitemsjeansjellyjoinsjointjokedjokesjollyjudgejuicejumpskeepskeyedkickskillskindskingskneesknifeknockknownknowslabellaborlackslagerlandslargelaserlastslaterlaughlayerleachleadsleanslearnleastleavelegallemonlendslevellibelliftslightlikedlikeslimbslimitlinedlineslinkslistsliterlivedliverlivesloadsloanslobbylocallockslodgelogiclooksloopslooselordslorryloseslousylovedloverloveslowerloyalluckylumpslunchlungslurkslyinglyricmagicmailsmainsmaizemajormakermakesmalesmaniamarchmarksmarrymatchmaybemayormealsmeansmeantmediameetsmendsmenusmercymergemeritmerrymessymetalmetermetromightmilesmimicmindsminedminesminorminusmistsmixedmixesmoansmodelmodesmoneymonthmoonsmoralmoronmotormottomountmousemouthmovedmovesmoviemucksmummymusicmythsnailsnaivenakednamednamesnastyneedsnervenestsnevernewernewlynicernicksnightnoblenodesnoisenoisynorthnosesnotednotesnounsnovelnurseobeysoccuroceanoddlyofferoftenolderomitsonionopensoperaoptedopticorbitorderorganotheroughtouterowingownedownerozonepackspagedpagespainspaintpairspanelpanicpantspaperparksparsepartspartypastepatchpathspausepayedpeacepeakspedalpeerspencependspennypettyphasephonephotopianopickspiecepilespillspilotpinchpintspipespitchpizzaplaceplainplaneplansplantplateplaysplotsplugspoemspoetspointpolarpollsportsposedposespostspoundpourspowerprayspresspriceprideprimeprintpriorprizeproneproofproseproudprovepullspulsepumpspunchpuntspupilpurgeputtsqueenqueryquestqueuequickquietquitequitsquotaquoterabidracedracesracksradarradioraidsrailsrainsraiserangeranksrantsrapidrarerratedratesratioravedravesrazorreachreactreadsreadyrealmreferreignrelaxrelayrendsrenewreplyresetrestsreuserhymeridesrightrigidringsrisenrisesrisksriskyrivalriverroadsrobotrocksrolesrollsromanroomsrootsroughroundrouteroutsroyalruinsruledrulerrulesrumorruralrustysackssadlysafersailssaintsalessaucesavedsavesscalescansscarescarfscenescopescorescrapscrewsealsseatssectsseeksseemssellssendssenseservesevensexesshadeshakeshakyshallshameshapesharesharpshedssheepsheersheetshelfshellshiftshineshinyshipsshirtshockshoesshoneshookshootshopsshortshotsshoutshoveshownshowsshutssidedsidessightsigmasignssillysincesingssinkssitessixthsixtysizedsizesskillskipsskirtskullslangslashslavesleepsleptsliceslideslipsslopeslotsslowssmallsmartsmashsmellsmilesmithsmokesnacksnailsneaksniffsobersockssolarsolessolidsolvesongssorrysortssoulssoundsouthspacesparespeakspeedspellspendspentspiesspikespillspitespitssplitspoilspokespoofspoolsportspotsspoutspraysquadstackstaffstagestairstakestalestallstampstandstarestarkstarsstartstatestaysstealsteamsteelsteepsteerstemsstepsstickstiffstillstirsstockstolestonestoodstopsstorestormstorystrawstraystripstuckstudystuffstunsstuntstylesugarsuingsuitesuitssunnysuperswampswapsswearsweatsweepsweetsweptswimsswingswordsworesworntabletackstailstakentakertakestalestalkstankstapestaskstastetaxesteachteamstearsteethtellstempttendstensetenthtermsterseteststextsthankthefttheirthemetherethesethickthiefthingthinkthirdthosethousthreethrewthrowthumbtigertighttilestimedtimertimestiredtirestitletoasttodaytokentonestoolstoothtopictotaltouchtoughtowertownstracetracktradetrailtraintrapstrashtreadtreattreestrendtrialtribetricktriedtriestripstrooptrucktrulytrunktrusttruthtubestunedtunesturnstutortwicetwinstwisttyingtypedtypesuncleunderundidunifyunionuniteunitsunityunsetuntilupperupseturbanurgedurgesusageusersusingusualuttervaguevalidvaluevalvevendsvenueverbsversevicarvideoviewsvinylvirusvisitvitalvocalvoicevomitvotedvotervotesvouchvowelwadedwadeswageswaitswakedwakeswalkswallswantswarmswarnswarpswastewatchwaterwavedwaveswearswearyweeksweighweirdwhalewheelwherewhichwhilewhitewholewhoopwhosewiderwidthwillswindswineswingswipedwipeswiredwireswiserwitchwittywiveswokenwomanwomenwoodswordsworksworldwormsworryworseworstworthwouldwoundwrapswrathwreckwristwritewrongwroteyardsyearsyieldyoungyoursyouthzeroszones";
const EXTRA = "abackabateabbeyabbotabetsabhorablerabodeabyssachedachesacidsacingacresacridadageadeptadobeadoreadornaffixafootagileaglowaidesailedairedaislealgaealibiallayalleyallotalloyaloftaloofaltaraltosamassambleamissamplyangstankleannexannulanticanvilaortaapingapronapteraptlyarborarcedardorariasarmoraromaarsonashedashenaskewaspenassesatoneatticauditauntsauralaurasautosavailavertavowsawingawokeaxingaxlesazurebabesbaconbagelbaggybailsbaitsbakerbaldsbaledbalesbalksbalmsbalmybandybangsbanjobarbsbardsbaredbarerbaresbargebarnsbaronbaserbasilbasinbasksbastebathebatonbawdybawlsbayedbayoubeadsbeadybeaksbeamsbeechbeefsbeefybeetsbefitbeigebelchbeliebellybeltsbentsberetberryberthbesetbestsbidesbikedbikesbingobipedbirchbisonbitchblabsblandblareblazebleakbleatbleedblendblimpblipsblitzblobsblocsblogsblondbloomblotsbluedbluerbluffbluntblursblurtblushboarsboastbodedbodesboltsbondsbonedboobybooedboomsboonsboorsboothbootyboozebosombossybotchboughboutsbowedbowelbowlsboxedboxerbracebragsbraidbrashbratsbravobrawlbrawnbraysbrewsbribebridebrimsbrinebrinkbrinybriskbroilbroodbrookbroombrothbrowsbruntbrutebuddybudgebuffsbuggybuglebulgebulksbulkybullsbullybumpsbumpybunksbunnybuoysburlyburpsburroburrsbusedbushybustsbuttebuttsbuxombywaycabincacaocachecacticadetcagedcagescageycakedcalkscalmscalvecamelcameocanalcandycanedcanescannycanoecanoncapedcapercapescaratcargocarolcarpscartscarvecaskscastecaulkcavedcavescawedcedarcededcedescellocentschafechaffchampchantchasmcheepchefschewychickchidechilichillchimechimpchinachinkchinschirpchokechorechowschugschumschurnchutecigarcinchcivicclackclampclamsclangclankclansclapsclaspclawscleatclefscleftclerkclimeclingclinkcloakclodsclogsclotscloutcloveclowncluckcluedclumpclungcoalscobracockscockycocoacoilscokedcokescoldscoliccoltscomascombscometconescooedcoopscoralcordscoredcorescorkscornscornycorpscouchcoupscovescovetcowedcowercoyercrabscragscramscranecrankcratecravecrazecreakcreekcrepecreptcrestcrewscribscroakcrockcronycrookcrooncrowscrumbcrustcryptcubedcubescuffscuingcullscultscurbscurdscuriocurlscutercystsczarsdaddydairydaisydallydamesdampsdandydarnsdartsdaubsdauntdawnsdazeddazesdeansdearsdebitdebtsdebutdecksdecoydecrydeepsdeferdeifydeigndelisdelvedemondenimdentsdepotdesksdiceddicesdietsdikeddikesdillsdimerdimesdimlydingydirerdirgedisksdittydiverdizzydocksdoersdoilydoleddolesdollsdollydomeddomesdonordopeddopesdopeydoseddoteddotesdoughdousedovesdowdydownsdownydowrydozeddozesdrabsdrapedrawldregsdrierdrolldronedrooldroopdrossdryerdrylyductsdudeddudesduelsduetsdukesdullsdullydumpyduncedunesdungsdunksdunnodupeddupesduskydustsduvetdwarfdwelldweltearlseasedeaseleaseseavesebbedebonyedgededgeredicteerieeggedejectekingelbowelderelegyelopeeludeelvesemailemberemirsemitsenactendowenemaensueenvoyepicsepocherecterodeerrederuptetherethosevadeevictevokeexaltexcelexertexileexpelextolexudeexultfablefacetfadedfadesfagotfairsfakedfakesfamedfangsfaredfaresfarmsfastsfatedfatesfattyfaunafawnsfazedfazesfeastfeatsfecesfeignfeintfellsfelonfeltsfendsfernsferryfetedfetidfetusfeudsfichefiendfieryfilchfiletfillyfilmyfilthfinchfishyfistsfivesflailflairflakeflakyflankflapsflareflaskflatsfleasfleckfleesflickflierflingflintflirtflitsflockflogsflopsfloraflossfloutfluesfluffflukeflungflunkfoalsfoamsfoamyfocalfoggyfoilsfoistfollyfootsforayfordsforesforgeforgoforksfortefortsfoulsfountfoursfowlsfoxedfoxesfoyerfrailfrancfraysfreerfretsfriarfrillfriskfrockfrondfrostfrothfuelsfullsfumedfungifurlsfurorfusedfusesgablegailygaitsgalasgalesgallsgamedgamergammagamutgangsgapedgapesgarbsgasesgaspsgatedgaudygaugegauntgauzegavelgawksgawkygayergazedgazesgeesegeldsgeniegeniigentsgenusgermsghoulgibedgibesgiddygildsgillsgiltsgimmegirthgladegladsglandglareglazegleamglensglideglintgloatglobegloomglossgluedgluesglutsgnarlgnashgnatsgnawsgoadsgoatsgodlygoldsgolfsgonergongsgonnagooeygoofsgoofygoonsgoosegoredgoresgorgegougegourdgownsgraftgramsgrapegrategravygraysgrazegreetgridsgrillgrimegrimygrinsgripegritsgroingroomgropegrovegrowlgrubsgruelgruffgruntguildguileguisegulchgulfsgullsgullygulpsgummyguppygurusgustsgustyguyedhailshaledhalerhaleshalonhalosharedharemharesharksharmsharpsharryhartshastehatchhaulshaunthavenhaveshawkshayedhazedhazelhazesheadyhealsheapsheathheavehedgeheedsheftyheirshelmsherbsherdsheronhewedhickshighshikedhikerhikeshillyhiltshindshingehippyhitchhivedhiveshoardhoboshockshoistholedhollyhomedhomeyhonedhoneshonkshoodshoofshoopshootshornshornyhosedhoseshotlyhoundhovelhoverhowlshuffshuffyhugerhulkshullshumidhumpshunchhunkshurlshuskshuskyhutchhyenahymnsiciericingidledidleridlesidolsiglooimpelineptinertinfixinkedinlayinletiotasirkedironsislesitchyiviesivoryjacksjadedjadesjailsjambsjauntjawedjeersjellsjerksjerkyjestsjettyjeweljibedjibesjiffyjiltsjokerjoltsjoyedjuicyjumbojumpyjunksjuntajurorkaratkayakkeelskeenskhakikilnskiloskiltskindakinkskinkykioskkitedkiteskittykiwisknackkneadkneedkneelkneltknitsknobsknollknotskoalakudoslacedlacesladedladenladesladlelairslakeslambslamedlamerlameslampslancelaneslankylapellapselardslarkslarvalatchlatexlathelathslaudslawnslaxerleafsleafyleaksleakyleapsleaptleaseleashledgeleechleeksleersleeryleftslemmeleperletupleveeleverliarslickslikenlikerlilacliltslimbolimedlimeslimpslinenlinerlingolionslispslithelivenlividllamaloafsloathlobesloftsloftyloinslollslongsloomsloonsloonylootslopedlopesloserlotuslouselowedlowlylucidluckslullslumpylunarlungelurchluredluresluridlustslustyluteslymphlynchlyresmacedmacesmachomadammadlymaidsmaimsmallsmaltsmamasmammamanesmangemangomangymanicmanlymanormaplemaresmariamarshmartsmasksmasonmastsmatedmatesmattemaulsmauvemaximmazesmealymeatsmedalmelonmeltsmemosmeowsmeresmetedmetesmewedmidstmiensmikedmikesmilksmilkymillsmimedmimesminceminerminksmintsmiredmiresmirthmisermistymitesmittsmixermoatsmocksmodalmoistmolarmoldsmoldymolesmoltsmonksmoodsmoodymooedmoorsmoosemootsmopedmopesmornsmossymotelmothsmotifmoundmournmousymovermowedmowermucusmuddymuffsmuggymulchmulesmullsmultimumpsmunchmuralmurkymusedmusesmushymustsmustymutedmutermutesmuttsnapesnappynasalnattynavalnavelnearsnecksneedyneighnewsynewtsnichenieceniftyninesninnyninthnippynoblynomadnooksnoosenormsnosednotchnudernudesnudgenullsnumbsnuttynylonnymphoaredoasesoasisoathsobeseoboesoctalodderodorsoffedogledoglesogresoiledokaysokrasoldenoliveomegaomensonsetoozedoozesopalsopiumoralsotterounceoustsoutdooutedovalsovaryovensoversovertoxidepacedpacespactspaddypaganpagerpailspaledpalerpalespallspalmspandapanespangspansypapalpapasparchparedparesparkapastapastspastypatespatiopattypavedpavespawedpawnspayerpeachpealspearlpearspecanpeckspeekspeelspeepspeevepeltspenalpenispeonspeonyperchperilperksperkypeskypestspetalpeterphonypickypierspietypikedpikespiledpinedpinespinkspiouspipedpiquepithypivotpixieplaidplankplazapleadpleaspleatpliedpliesplodsplopsplowsployspluckplumbplumeplumpplumsplushpoachpoisepokedpokerpokespokeypoledpolespoliopolkapolyppondspoolspoopspoppyporchporedporespouchpoutsprankprawnpreenpreysprickpriedpriesprimpprismprivyprobeprodspromsprongpropsprowlprowsproxyprudeprunepsalmpsychpuckspudgypuffspuffypukedpukespulpspumaspunkspuppypureepurerpurrspursepushypussyputtypyresquackquailquakequalmquarkquartquashquaysqueerquellquillquiltquipsquirkrabbiracerradiiraftsragedragesrainyrakedrakesrallyrampsranchrapedrapesraredraresraspsrattyravelravenrawerrayonrazedrazesrealsreamsreapsrearsrebelrebutrecaprecurredidreedsreefsreeksreelsregalreinsrelicremitrentsrepayrepelresinretchretryrevelrevuerhinoricedricesriderridgeriferrifleriftsrigorriledrilesrindsrinksrinseriotsripenriperriserritesrivetroachroamsroarsroastrobedrobesrobinrockyrodeoroguerompsroofsrooksroomyroostropedropesrosesrotorrougerouserowdyrowedruddyruderruffsrugbyruingrummyrumpsrunesrungsrunnyruntsrusesrustssabersadessafessagassagersagessaladsallysalonsaltssaltysalvesamessandssandysanersangssarissassysatinsaucysaunasaversavorsavvysawedscabsscaldscalpscalyscantscarsscaryscentscoffscoldscoopscootscornscourscoutscowlscramscrubscuffscumsseamssearssedanseedsseedyseepsseizesemenserumseversewedsewersexedshackshadyshaftshamssharkshaveshawlsheafshearsheenshiedshiesshinsshireshirkshoalshoosshoreshowyshredshrewshrubshrugshuckshunsshuntshyersickssidlesiegesievesiftssighssilkssillssilossiltssinewsingesinussiredsirensiressissysitedsixessizerskateskeinskewsskidsskiedskiesskimpskimsskinsskitsskulkskunkslabsslackslainslakeslamsslantslapsslateslatsslayssledssleeksleetslewsslickslierslimeslimsslimyslingslinkslitsslobsslogsslopssloshslothslugsslumpslumsslungslunkslursslushslutsslylysmacksmearsmeltsmirksmitesmocksmokysmotesmutssnagssnakesnapssnaresnarlsneersnidesnipesnipssnobssnoopsnoresnortsnotssnoutsnowssnowysnubssnuffsnugssoakssoapssoapysoarssodassofassoggysoilssoledsolossonicsootysorersoressortasoupssourssowedspadespankspanssparksparsspasmspatespatsspawnspaysspearspeckspermspewsspicespicyspiedspinespinsspiresplatspookspoonsporespreesprigspudsspunkspurnspursspurtsquatsquidstabsstagsstaidstainstalkstankstavesteaksternstewsstingstinkstintstokestompstonystoolstoopstorkstoutstovestowsstrapstrewstrumstrutstubsstudsstumpstungstunksuavesuckssuedesulkssulkysunupsurersurfssurgesurlyswabsswansswarmswatsswaysswellswiftswigsswillswineswipeswirlswishswoonswoopswungsyruptabbytabootacittackytacostainttallytalontamedtamertamestangotangstapedtapertardytarrytartstastytattytaunttawnytaxedtaxisteaksteaseteatsteemsteenstempotenettenortentstepeetepidthawsthetathighthinsthongthornthrobthudsthugsthumpthymetiaratickstidaltidedtidestierstiffstildetiledtillstiltstimidtingetingstinnytintstipsytoadstogastoilstollstombstomestonaltonedtongstonictonnetootstopaztorchtorsototedtotemtotestourstoutstowedtoweltoxictoxintoyedtracttraittramptrawltraystreedtrekstrilltrimstriostripetritetrolltrotstrouttrucetruedtruertruestrumptubastubedtuckstuftstuliptummytumortunastunertunicturfstuskstwangtweaktweedtweettwigstwinetwirludderulcerultrauncutundueunfitunmanunsayuntieupenduppedurineusherusurputerivaletvalorvanesvaporvasesvastsvaultveersveilsveinsvenomventsvergevervevestsvexedvexesvialsvicedvicesvigilvigorvilervillavinesviolaviperviralvisasvisedvisesvisorvistavividvodkavoguevoidsvoltsvowedvyingwaferwaftswagedwagerwagonwaifswailswaistwaivewakenwaltzwandswanedwaneswannawardswartswaspswattswaverwaxedwaxesweansweavewedgeweedsweedyweepsweestweldswellsweltswhackwharfwhatswheatwhenswhetswhiffwhimswhinewhipswhirlwhirswhiskwhorewickswidenwidowwieldwildswiltswincewinchwindywinedwinkswiperwiseswispswispywolfswombswoodywooedwoofswordywovenwowedwreakwrenswrestwringwritswrungwryeryachtyanksyarnsyawnsyearnyeastyellsyelpsyesesyodelyokedyokelyokesyolksyowlszebrazestszincszonedzooms";
const WORDS_PER_ROUND = 5, ROUNDS = 2, GUESSES = 5, STOPPERS = 3, QUESTION_BALLS = 3, START_COVERED = 10;

const answerAt = (i) => ANSWERS.slice(i * 5, i * 5 + 5);
const ANSWER_COUNT = ANSWERS.length / 5;
function inList(list, w) {
  let lo = 0, hi = list.length / 5;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = list.slice(mid * 5, mid * 5 + 5);
    if (x === w) return true;
    if (x < w) lo = mid + 1; else hi = mid;
  }
  return false;
}
const isValid = (w) => inList(ANSWERS, w) || inList(EXTRA, w);

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LINES = [];
for (let i = 0; i < 5; i++) {
  LINES.push([0, 1, 2, 3, 4].map((k) => i * 5 + k));
  LINES.push([0, 1, 2, 3, 4].map((k) => k * 5 + i));
}
LINES.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
const hasLingo = (covered) => LINES.some((line) => line.every((c) => covered[c]));

/** A card (25 numbers, row-major; column c holds 10c+1..10c+10 of the team's parity) with ten covered. */
function newCard(team, rng) {
  const cols = [0, 1, 2, 3, 4].map((c) => shuffle([1, 3, 5, 7, 9].map((k) => 10 * c + k + team), rng));
  const numbers = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) numbers.push(cols[c][r]);
  let covered;
  do {
    const pick = new Set(shuffle([...Array(25).keys()], rng).slice(0, START_COVERED));
    covered = numbers.map((_, i) => pick.has(i));
  } while (hasLingo(covered));
  return { numbers, covered };
}

/** The hopper: one ball per open number, the stoppers, and in round 2 the "?" balls. */
function newHopper(card, round) {
  const balls = card.numbers.filter((_, i) => !card.covered[i]).map(String);
  for (let k = 0; k < STOPPERS; k++) balls.push("R");
  if (round === 2) for (let k = 0; k < QUESTION_BALLS; k++) balls.push("?");
  return balls;
}

/** Red/yellow marks for a guess, like the show: 2 = right place, 1 = elsewhere in the word, 0 = not in it. */
function marks(guess, word) {
  const out = [0, 0, 0, 0, 0];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === word[i]) out[i] = 2;
    else left[word[i]] = (left[word[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 0 && left[guess[i]]) { out[i] = 1; left[guess[i]]--; }
  }
  return out;
}

const otherTeam = (t) => 1 - t;
const teamSeats = (state, team) => (state.seats === 2 ? [team] : [team, team + 2]);
const mult = (state) => (state.round === 2 ? 2 : 1);

function startWord(state, rng) {
  const used = new Set(state.used);
  let index;
  do { index = Math.floor(rng() * ANSWER_COUNT); } while (used.has(index) && used.size < ANSWER_COUNT);
  const team = state.word_no % 2 === 0 ? 0 : 1;
  const revealed = [true, false, false, false, false];
  return { ...state, word: answerAt(index), used: [...state.used, index], revealed, guesses: [], control: team,
           phase: "guess", tries: 0, to_move: teamSeats(state, team)[0], draws_left: 0 };
}

/** After a word ends (solved, then drawn, or discarded): next word, next round, or the end. */
function nextWord(state, rng) {
  const word_no = state.word_no + 1;
  if (word_no >= WORDS_PER_ROUND * ROUNDS) {
    const best = Math.max(...state.scores);
    return { ...state, phase: "over", word_no, winners: [0, 1].filter((t) => state.scores[t] === best), last_word: state.word };
  }
  let next = { ...state, word_no, last_word: state.word };
  if (word_no === WORDS_PER_ROUND) {
    // Round 2: the hoppers get their "?" balls.
    next = { ...next, round: 2, hoppers: next.cards.map((card) => newHopper(card, 2)) };
  }
  return startWord(next, rng);
}

function solved(state, team, rng) {
  const scores = state.scores.map((s, t) => (t === team ? s + 25 * mult(state) : s));
  const seats = teamSeats(state, team);
  return { ...state, scores, phase: "draw", control: team, draws_left: 2, to_move: seats[0], revealed: [true, true, true, true, true],
           draw_log: [] };
}

function passControl(state) {
  const team = otherTeam(state.control);
  const revealed = [...state.revealed];
  const hidden = revealed.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (hidden.length > 1) revealed[hidden[0]] = true;
  return { ...state, revealed, control: team, phase: "steal", to_move: teamSeats(state, team)[0] };
}

/** One guess from [seat]. */
function guess(state, seat, word, rng) {
  const team = state.control;
  const w = word.toLowerCase();
  const valid = w.length === 5 && isValid(w);
  const entry = { team, seat, word: w, marks: valid ? marks(w, state.word) : null };
  let next = { ...state, guesses: [...state.guesses, entry] };
  if (valid && w === state.word) return solved(next, team, rng);
  if (state.phase === "steal") return nextWord({ ...next, discarded: true }, rng);
  const tries = state.tries + 1;
  if (valid) next = { ...next, revealed: next.revealed.map((r, i) => r || entry.marks[i] === 2) };
  if (!valid || tries >= GUESSES) return passControl({ ...next, tries });
  const seats = teamSeats(state, team);
  return { ...next, tries, to_move: seats[tries % seats.length] };
}

/** Covers the open number that best completes a line (for a "?" ball). */
function bestOpen(card) {
  let best = -1, bestScore = -1;
  card.covered.forEach((c, i) => {
    if (c) return;
    const score = LINES.filter((l) => l.includes(i)).reduce((m, l) => Math.max(m, l.filter((x) => card.covered[x]).length), 0);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

function draw(state, seat, rng) {
  const team = state.control;
  const hopper = state.hoppers[team];
  const pick = Math.floor(rng() * hopper.length);
  const ball = hopper[pick];
  const hoppers = state.hoppers.map((h, t) => (t === team ? h.filter((_, i) => i !== pick) : h));
  let cards = state.cards;
  let scores = state.scores;
  let lingo = false;
  if (ball !== "R") {
    const card = cards[team];
    const cell = ball === "?" ? bestOpen(card) : card.numbers.indexOf(Number(ball));
    const covered = card.covered.map((c, i) => c || i === cell);
    cards = cards.map((c, t) => (t === team ? { ...c, covered } : c));
    if (hasLingo(covered)) {
      lingo = true;
      scores = scores.map((s, t) => (t === team ? s + 50 * mult(state) : s));
    }
  }
  const log = [...state.draw_log, { seat, ball, lingo }];
  let next = { ...state, hoppers, cards, scores, draw_log: log, draws_left: state.draws_left - 1 };
  if (lingo) {
    const fresh = newCard(team, rng);
    next = { ...next, cards: next.cards.map((c, t) => (t === team ? fresh : c)),
             hoppers: next.hoppers.map((h, t) => (t === team ? newHopper(fresh, state.round) : h)), lingos: state.lingos.map((n, t) => (t === team ? n + 1 : n)) };
  }
  if (ball === "R" || next.draws_left === 0) return nextWord(next, rng);
  const seats = teamSeats(state, team);
  return { ...next, to_move: seats[(2 - next.draws_left) % seats.length] };
}

function apply(state, seat, move, rng) {
  if (state.phase === "over") throw new InvalidMove("the game is over");
  if (seat !== state.to_move) throw new InvalidMove("it is not your turn");
  if (state.phase === "draw") {
    if (!("draw" in move)) throw new InvalidMove("draw a ball");
    return draw(state, seat, rng);
  }
  if (!("guess" in move)) throw new InvalidMove("guess the word");
  return guess(state, seat, move.guess, rng);
}

function validateMove(move) {
  const keys = move && typeof move === "object" && !Array.isArray(move) ? Object.keys(move) : [];
  const ok = keys.length === 1 && (
    (keys[0] === "guess" && typeof move.guess === "string" && /^[a-zA-Z]{1,12}$/.test(move.guess)) ||
    (keys[0] === "draw" && move.draw === true));
  if (!ok) throw new InvalidMove("send a guess or draw a ball");
}

const seatOf = (ctx, playerId) => ctx.players.findIndex((p) => p.id === playerId);

function payouts(winners, ctx, seats) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  if (!humans.length) return {};
  const out = Object.fromEntries(humans.map((h) => [h.id, 0]));
  let takers = ctx.players.filter((p, s) => winners.includes(s % 2) && p.kind === "human");
  if (!takers.length) takers = humans;
  const share = Math.floor(ctx.pot / takers.length);
  takers.forEach((p, i) => { out[p.id] = share + (i < ctx.pot - share * takers.length ? 1 : 0); });
  return out;
}

/** Words consistent with everything shown so far (the computer's guesses). */
function candidates(state) {
  const out = [];
  for (let i = 0; i < ANSWER_COUNT; i++) {
    const w = answerAt(i);
    if (state.revealed.some((r, k) => r && w[k] !== state.word[k])) continue;
    if (state.guesses.some((g) => g.marks && marks(g.word, w).join() !== g.marks.join())) continue;
    out.push(w);
  }
  return out;
}

const game = {
  newMatch(ctx) {
    const rng = () => ctx.random();
    const seats = ctx.players.length;
    const cards = [newCard(0, rng), newCard(1, rng)];
    const base = { seats, round: 1, word_no: 0, scores: [0, 0], lingos: [0, 0], cards, hoppers: cards.map((c) => newHopper(c, 1)),
                   used: [], draw_log: [], last_word: null, discarded: false, winners: null };
    const state = startWord(base, rng);
    return { state, turn: [ctx.players[state.to_move].id] };
  },

  applyMove(state, playerId, move, ctx) {
    validateMove(move);
    const rng = () => ctx.random();
    let next = apply({ ...state, discarded: false }, seatOf(ctx, playerId), move, rng);
    if (next.phase === "over") return { state: next, turn: null, payouts: payouts(next.winners, ctx, state.seats) };
    return { state: next, turn: [ctx.players[next.to_move].id] };
  },

  computerMove(state, playerId, ctx) {
    if (state.phase === "draw") return { draw: true };
    const list = candidates(state);
    return { guess: list.length ? list[Math.floor(ctx.random() * list.length)] : "crane" };
  },

  randomMove(state, playerId, ctx) {
    if (state.phase === "draw") return { draw: true };
    const r = ctx.random();
    if (r < 0.15) return { guess: "zzzzz" };
    if (r < 0.5) return { guess: answerAt(Math.floor(ctx.random() * ANSWER_COUNT)) };
    const list = candidates(state);
    return { guess: list.length ? list[Math.floor(ctx.random() * list.length)] : "crane" };
  },

  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : seatOf(ctx, playerId);
    const over = state.phase === "over";
    return {
      seats: state.seats, round: state.round, word_no: state.word_no, words_per_round: WORDS_PER_ROUND, phase: state.phase,
      control: state.control, to_move: state.to_move, tries: state.tries, scores: state.scores, lingos: state.lingos,
      // The mystery word stays hidden: only revealed letters (or the whole word once solved or over).
      letters: state.revealed.map((r, i) => (r || over ? state.word[i] : null)),
      guesses: state.guesses, cards: state.cards, hopper_counts: state.hoppers.map((h) => h.length),
      draws_left: state.draws_left, draw_log: state.draw_log, last_word: state.last_word, discarded: state.discarded,
      winners: state.winners, my_seat: seat >= 0 ? seat : null,
    };
  },
};
