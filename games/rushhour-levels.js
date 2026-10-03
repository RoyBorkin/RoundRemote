// Rush Hour levels — 4 packs × 12, each [board, optimal moves].
// Board: 36 chars, row-major 6×6, top row first. 'A' = the red car (row 3, exits right), other letters =
// cars (2 cells) / trucks (3 cells), 'o' = empty, 'x' = wall. One move = one vehicle slid any distance.
// Generated for this app (not taken from any commercial puzzle set): random boards were grown and mutated
// (hill climbing on the piece set); for each piece set a BFS walked its whole state graph, a multi-source BFS
// from the solved states (red car at the exit) gave every state its optimal distance, and the hardest state
// was kept. 16636 unique candidates; 12 per pack were picked across the move ranges, sorted by length,
// and every stored level was re-checked with an independent BFS solver (solvable, optimum matches).
export const PACKS = [
  { id: 'beginner', name: 'Beginner', levels: [
    ['ooooBBoCCooDAAoooDoEFFGGHEooooHooooo', 3],
    ['BoCCooBoooDDooAAoEFFoGGEHIooJJHIoKKK', 3],
    ['BoooCCBDDDEEAAFooGooFHHGIoooJJIoKKoo', 4],
    ['ooooBBCoooDDCAAEFGCHoEFGIHJoooIHJKKK', 4],
    ['oBoCCCoBDoEEAADFGHoooFGHIJooooIJKKKo', 5],
    ['BCooooBCoDooAAEDFGHHEoFGoooIoJKKKIoJ', 5],
    ['oBBCCoDDEFFGooEAAGHoEooGHIJJKKoIooLL', 6],
    ['BooCCoBoDDEFAAoGEFoHoGIIoHoJJooHKKKo', 6],
    ['ooBBCCoooDoEoAADoEoFGGHHoFooIIoooooo', 7],
    ['BBBoCCDDDoEEoooAAFoooGoFoHoGoFoHoGII', 7],
    ['BBoCooDEoCFFDEAAGoHHHoGoIJJoKKIooLLo', 8],
    ['BCCoDDBEoFFoGEAAHIGooJHIoooJKKLLLooo', 8],
  ] },
  { id: 'intermediate', name: 'Intermediate', levels: [
    ['BooCCCBooDEEFAADooFoGGooHHIIJKLLLoJK', 9],
    ['BCDDDEBCFooEAAFoGHIJJoGHIoKKooLLMMMo', 10],
    ['oBoCCooBoDEooAADEooooFGGoHIFoJoHIKKJ', 10],
    ['ooBCCCDDBEFoGAAEFHGIIJoHoooJoKLLMMoK', 11],
    ['BoCDEEBoCDoFGAAHIFGJJHIoooooKLMMooKL', 12],
    ['oBBBoooooCDDAAECoFooEGGFHHIIJKooLLJK', 12],
    ['oBCCDDoBEEFFAAoGHIoJJGHIKoLLoMKoNNoM', 13],
    ['oBBoCCDooEFFDAAEoGoHIJJGoHIoKLoMMMKL', 14],
    ['BBBoCoDDDoCEooAACEooFGoEHoFGIIHJJoKK', 14],
    ['oBBoCCDDEoFoAAEoFoooGHHIooGJoIKKKJoI', 15],
    ['BooCCCBooooDAAEFoDGGEFHDoIJJHooIKKLL', 16],
    ['oBCCDooBEoDoAAEoFGHIIJFGHooJKKoooooo', 16],
  ] },
  { id: 'advanced', name: 'Advanced', levels: [
    ['BoCCDDBooEFFBAAEGHIJKKGHIJLooMNNLooM', 17],
    ['BoCCDDBoEEFGHoAAFGHIIJJGKKoLooMMoLNN', 18],
    ['BCooDDBCEEFFAAGoooHoGIJKHLLIJKMMNNNo', 18],
    ['BBCDooEoCDFFEoAAGHooIIGHJJooKLMMNNKL', 19],
    ['BoCCDoBEEEDFAAooDFGoHIIFGoHJooKKKJoo', 20],
    ['BBoCoDEooCoDEAAFooooGFHHIoGJJKIoLLLK', 21],
    ['BCDDEEBCoFFGoAAoHGIIJJHGKooLMMKooLoo', 21],
    ['oBCCoDoBoooDEAAFGHEIIFGHooJKoHooJKLL', 22],
    ['BCCoooBoDoooAADEFoGGHEFIooHJKILLLJKI', 23],
    ['BoCCDDBooooEAAFGoEooFGHHIIIoJKLLooJK', 24],
    ['BCDDEEBCFFoGoCHAAGIIHJoGooKJLLMMKooo', 25],
    ['BBCCDEFFoGDEHAAGooHoIJKKLLIJoooMMMoo', 25],
  ] },
  { id: 'expert', name: 'Expert', levels: [
    ['oBBCoooDECFFoDEAAGHHIooGJJIooKoLLMMK', 26],
    ['BCCDDoBoEFFGAAEHoGIJoHKKIJLLMooNNoMo', 27],
    ['BoCCooBDDEFGAAHEFGIIHoooJJJKKLMMNNoL', 29],
    ['BoCCDEBFFFDEAAGHIEooGHIooooJKKoooJLL', 31],
    ['oBBCDoooECDoAAEFDoooGFHHIoGJJKIooLLK', 33],
    ['BCCDooBoEDFFGoEAAHGoIooHooIJJKLLoMMK', 35],
    ['BBBCDoEEECDooAAFDoGoHFIIGoHJJKoooooK', 37],
    ['oBBBCDEEoFCDAAoFGoHIIoGoHoJKLLMMJKoo', 39],
    ['BBBCCoDDDEooAAFEoGooFHHGIoJJKLIMMMKL', 41],
    ['BoooCCBoDDDEAAoFoEGGHFoEooHIJJoKKIoo', 42],
    ['BCCCooBDDDEFAAGHEFIIGHEFoooJKKoLLJoo', 45],
    ['BBBCDEFGGCDEFoAADEHHIooooJIoKKoJLLMM', 49],
  ] },
];
