// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Notes Game starter pack: well-known people, characters and things everyone can act out — about 260 in English and
// 280 in Hebrew (Israeli favourites plus the world's famous names written in Hebrew). Our own list.
const EN = `Albert Einstein|Cleopatra|Napoleon|Julius Caesar|Leonardo da Vinci|William Shakespeare|Mozart|Beethoven|Isaac Newton|Charles Darwin|Marie Curie|Abraham Lincoln|
George Washington|Queen Elizabeth II|Mahatma Gandhi|Martin Luther King Jr.|Nelson Mandela|Winston Churchill|Joan of Arc|Christopher Columbus|Marco Polo|Galileo|Pablo Picasso|
Vincent van Gogh|Frida Kahlo|Michelangelo|Thomas Edison|Nikola Tesla|Steve Jobs|Bill Gates|Elon Musk|Neil Armstrong|Amelia Earhart|Anne Frank|Sigmund Freud|Genghis Khan|
Alexander the Great|Tutankhamun|Henry VIII|Marie Antoinette|Florence Nightingale|Walt Disney|Charlie Chaplin|Harry Houdini|Socrates|Robin Hood|King Arthur|Elvis Presley|
The Beatles|Michael Jackson|Madonna|Beyoncé|Taylor Swift|Lady Gaga|Rihanna|Freddie Mercury|Bob Marley|Elton John|Adele|Ed Sheeran|Justin Bieber|Billie Eilish|Dolly Parton|
Frank Sinatra|Marilyn Monroe|Audrey Hepburn|Tom Cruise|Leonardo DiCaprio|Brad Pitt|Meryl Streep|Oprah Winfrey|Arnold Schwarzenegger|Jackie Chan|Bruce Lee|Will Smith|
Dwayne Johnson|Johnny Depp|Morgan Freeman|Keanu Reeves|Tom Hanks|Mr. Bean|Gordon Ramsay|David Attenborough|Steven Spielberg|Lionel Messi|Cristiano Ronaldo|Michael Jordan|
Serena Williams|Usain Bolt|Muhammad Ali|Roger Federer|LeBron James|Pelé|Diego Maradona|Tiger Woods|Michael Phelps|Simone Biles|Harry Potter|Hermione Granger|Voldemort|
Dumbledore|Hagrid|Gandalf|Frodo|Gollum|Bilbo Baggins|Sherlock Holmes|James Bond|Indiana Jones|Darth Vader|Luke Skywalker|Yoda|Chewbacca|Batman|Superman|Spider-Man|
Wonder Woman|Iron Man|The Hulk|Captain America|The Joker|Mickey Mouse|Donald Duck|Winnie the Pooh|Bugs Bunny|SpongeBob|Homer Simpson|Bart Simpson|Scooby-Doo|Shrek|
Elsa|Cinderella|Snow White|Peter Pan|Tinker Bell|Pinocchio|Alice in Wonderland|Little Red Riding Hood|Dracula|Frankenstein|Santa Claus|The Easter Bunny|The Tooth Fairy|
Mario|Pikachu|Sonic the Hedgehog|Lara Croft|Pac-Man|Barbie|Garfield|Snoopy|Charlie Brown|Tarzan|Zorro|Godzilla|King Kong|E.T.|Rocky Balboa|Forrest Gump|The Terminator|
Willy Wonka|Mary Poppins|Captain Hook|Jack Sparrow|Buzz Lightyear|Woody|Nemo|Dory|Simba|Aladdin|The Genie|The Little Mermaid|Mulan|Moana|Stitch|The Minions|Kermit the Frog|
Miss Piggy|Cookie Monster|Big Bird|Rapunzel|Hercules|Zeus|Medusa|Thor|Cupid|Sleeping Beauty|Hansel and Gretel|Paddington Bear|Peppa Pig|Dora the Explorer|Bob the Builder|
Thomas the Tank Engine|Tom and Jerry|Popeye|Uncle Sam|The Mona Lisa|The Statue of Liberty|Wednesday Addams|The Grinch|The Cat in the Hat|Humpty Dumpty|Bambi|Dumbo|
Rudolph the Red-Nosed Reindeer|Frosty the Snowman|Pippi Longstocking|Matilda|The Little Prince|Don Quixote|Oliver Twist|Romeo and Juliet|Sinbad|Ali Baba|Mowgli|Baloo|
Teenage Mutant Ninja Turtles|The Smurfs|Smurfette|Gru|Olaf|Ratatouille|Wall-E|Mrs. Doubtfire|Katniss Everdeen|Jon Snow|Walter White|Mr. Spock|Captain Jack|Hannibal Lecter|
Cruella de Vil|Maleficent|Ursula|Captain Nemo|Robinson Crusoe|Gulliver|The Pied Piper|Goldilocks|The Big Bad Wolf|Puss in Boots|Shaun the Sheep|Wallace and Gromit|
The Eiffel Tower|The Titanic|The Loch Ness Monster|Bigfoot|Mount Everest|The Pyramids|The Great Wall of China|Big Ben|Stonehenge|The Leaning Tower of Pisa|Mount Rushmore|
The Hogwarts Express|The Batmobile|The Death Star|Excalibur|The Holy Grail|Noah’s Ark|The Trojan Horse|Atlantis|The Wizard of Oz|Dorothy|The Tin Man|The Cowardly Lion`;

const HE = `אלברט איינשטיין|קליאופטרה|נפוליאון|יוליוס קיסר|לאונרדו דה וינצ'י|שייקספיר|מוצרט|בטהובן|אייזק ניוטון|צ'רלס דרווין|מארי קירי|אברהם לינקולן|מהטמה גנדי|נלסון מנדלה|
וינסטון צ'רצ'יל|ז'אן ד'ארק|כריסטופר קולומבוס|פיקאסו|ואן גוך|תומאס אדיסון|סטיב ג'ובס|ביל גייטס|אילון מאסק|ניל ארמסטרונג|אנה פרנק|זיגמונד פרויד|וולט דיסני|צ'רלי צ'פלין|
אלביס פרסלי|הביטלס|מייקל ג'קסון|מדונה|ביונסה|טיילור סוויפט|ליידי גאגא|פרדי מרקורי|בוב מארלי|מרילין מונרו|טום קרוז|ליאונרדו דיקפריו|אופרה ווינפרי|ארנולד שוורצנגר|
ג'קי צ'אן|ברוס לי|מר בין|ליונל מסי|כריסטיאנו רונאלדו|מייקל ג'ורדן|אוסיין בולט|מוחמד עלי|רוג'ר פדרר|פלה|מראדונה|
דוד בן גוריון|גולדה מאיר|יצחק רבין|מנחם בגין|בנימין זאב הרצל|שמעון פרס|משה דיין|אליעזר בן יהודה|חנה סנש|יוסף טרומפלדור|אילן רמון|
נעמי שמר|אריק איינשטיין|שלמה ארצי|עפרה חזה|זוהר ארגוב|יהורם גאון|שלום חנוך|מתי כספי|יהודית רביץ|חוה אלברשטיין|גידי גוב|ריטה|שרית חדד|עומר אדם|נועה קירל|
אייל גולן|עידן רייכל|אביב גפן|נטע ברזילי|ישי ריבו|סטטיק ובן אל|עדן בן זקן|מרגלית צנעני|אריק סיני|שושנה דמארי|ירדנה ארזי|דנה אינטרנשיונל|מאיר אריאל|ברי סחרוף|
שלמה אבידן|ששון גבאי|שייקה אופיר|אורי זוהר|חיים טופול|גל גדות|נטלי פורטמן|ליאור רז|אסי כהן|הגשש החיוור|דודו טופז|שלום אסייג|טל ברודי|יוסי בניון|ערן זהבי|
גל פרידמן|לינוי אשרם|ארטיום דולגופיאט|דני אבדיה|חיים נחמן ביאליק|ש"י עגנון|רחל המשוררת|לאה גולדברג|אפרים קישון|דבורה עומר|יהודה עמיחי|עמוס עוז|מאיר שלו|
שרוליק|קישקשתא|פרפר נחמד|אצבעוני|מוישה אופניק|אדון שוקו|יובל המבולבל|דודלי|סבתא בישלה דייסה|אליעזר והגזר|
שמשון הגיבור|דוד וגוליית|המלכה אסתר|המן הרשע|מרדכי|יהודה המכבי|נח והתיבה|שלמה המלך|
הארי פוטר|הרמיוני|וולדמורט|דמבלדור|האגריד|גנדלף|גולום|פרודו|שרלוק הולמס|ג'יימס בונד|אינדיאנה ג'ונס|דארת' ויידר|יודה|באטמן|סופרמן|ספיידרמן|וונדר וומן|
איירון מן|הענק הירוק|הג'וקר|מיקי מאוס|דונלד דאק|פו הדב|באגס באני|בובספוג|הומר סימפסון|בארט סימפסון|סקובי דו|שרק|אלזה|סינדרלה|שלגיה|פיטר פן|טינקרבל|
פינוקיו|עליסה בארץ הפלאות|כיפה אדומה|רובין הוד|המלך ארתור|דרקולה|פרנקנשטיין|סנטה קלאוס|סופר מריו|פיקאצ'ו|סוניק|פקמן|ברבי|גארפילד|סנופי|טרזן|זורו|גודזילה|
קינג קונג|אי.טי.|רוקי|פורסט גאמפ|המחסל|וילי וונקה|מרי פופינס|קפטן הוק|ג'ק ספארו|באז שנות אור|וודי|נמו|דורי|סימבה|אלאדין|הג'יני|בת הים הקטנה|מולאן|מואנה|סטיץ'|
המיניונים|קרמיט הצפרדע|עוגיפלצת|רפונזל|הרקולס|זאוס|מדוזה|ת'ור|קופידון|היפהפייה הנרדמת|עמי ותמי|הדב פדינגטון|פפה פיג|דורה|בוב הבנאי|תומס הקטר|טום וג'רי|פופאי|
מונה ליזה|פסל החירות|וונסדיי אדאמס|הגרינץ'|החתול תעלול|במבי|דמבו|רודולף|בילבי|מטילדה|הנסיך הקטן|דון קישוט|אוליבר טוויסט|רומיאו ויוליה|סינבד|עלי באבא|מוגלי|
צבי הנינג'ה|הדרדסים|דרדסית|גרו|אולף|רטטוי|וול-E|קטניס אוורדין|ג'ון סנואו|קרואלה דה ויל|מליפיסנט|גוליבר|רובינזון קרוזו|החלילן מהמלין|זהבה ושלושת הדובים|
הזאב הרע|החתול במגפיים|הקוסם מארץ עוץ|דורותי|איש הפח|מגדל אייפל|הטיטניק|המפלצת מלוך נס|ביגפוט|הר האוורסט|הפירמידות|החומה הסינית|ביג בן|המגדל הנטוי בפיזה|
הכותל|מצדה|ים המלח|תיבת נח|הסוס הטרויאני|אטלנטיס|החרב אקסקליבר|רכבת הוגוורטס`;

const parse = (s) => s.split('|').map((x) => x.trim()).filter(Boolean);
export const PACK = { en: parse(EN), he: parse(HE) };
