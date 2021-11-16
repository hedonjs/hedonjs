#!/usr/bin/node
'use strict';

const fs = require('fs');
const beautify = require('js-beautify').js;
const vm = require('vm');
const c = require('ansi-colors');
const highlight = require('cli-highlight').highlight;
const highlightThemeParse= require('cli-highlight').parse;

const hltheme = highlightThemeParse( JSON.stringify({keyword: 'cyan', literal: 'yellow'}) );
const highlightOpts = { language: 'javascript', ignoreIllegals: true, theme: hltheme};

const {stdin, stdout} = process;
const contexts = {};


function createFragment(name) {
    return {
        name,
        revision:-1,
        detached: false,
        code: [''],
        edit: {
            row: 0,
            col: 0,
            executed: false,
            error: false,
        },
        out: [],
    };
}

function addFragment(map, frag) {
    return map[frag.name]=frag;
}

let logOut = null;

const viewPort = {
    height: 100,
    width: 80,
    firstLine: 0,
    curPos: 0,
};

function ctxLog(...out) {
    if(!logOut) {
        console.log(...out);
    } else {
        logOut.push( out.join(' ') );
    }
}


const help = `==== hedon interactive, help ==== <=
  ctrl + d  - delete line
  ctrl + r  - run fragment
  ctrl + alt + r - run all fragments
  ctrl + k  - remove fragment
  ctrl + n  - clear context
  ctrl + l  - clear all frament outputs
  ctrl + c  - exit
  ins       - detach/attach fragment
  pgup      - first line of fragment
  pgdn      - last line of fragment
  ctrl + pgup - previous fragment
  ctrl + pgdn - next fragment
  alt + pgup  - scroll up
  alt + pgdn - scroll down
  ctrl + up - previous fragment revision
  ctrl + dn - next fragment revision
  tab       - autocomplete word or insert tab
  Also look at the methods on $meta.

`;

function ctxSave(fn) {
    if(!fn) {
        return '$meta.save(\'filename\'); Save all fragment source to file.';
    }

    const out = [];

    for(const fragName in curCtx.$meta.fragments) {
        const frag = curCtx.$meta.fragments[fragName];
        for( const l of frag.code ) {
            out.push(l);
        }
    }

    try {
        fs.writeFileSync(fn,out.join('\n'));
    } catch(e) {
        return `Couldn't write file.`;
    }
    return `Written ${out.length} lines to ${fn}.`;
}

function ctxLoad(fn, overwrite) {
    if(!fn) {
        return '$meta.load(\'filename\', ?overwrite=false); loads file into new fragment. ';
    }

    try {
        const source = (`// File: ${fn}\n`+fs.readFileSync( fn, {encoding:'utf8'})).split('\n');
        
        let fragName = 'file_'+fn;
        if(!overwrite) {
            let i=0;
            while( curCtx.$meta.fragments[fragName] ) {
                fragName = 'file_'+fn+'_'+(i++);
            }
        }

        const newFrag = addFragment( curCtx.$meta.fragments, createFragment(fragName));

        newFrag.code = source;

        return `Read ${source.length-1} lines from ${fn}.`;
        curCtx.$meta.curFrag.edit.executed=false;
    } catch(e) {
        return `Couldn't load file`;
    }
}

function ctxMergeFrags(a,b) {
    if(!b) {
        return `mergeFrags( fragNameA, fragNameB ); Merge fragmentB into fragmentA and delete fragmentB`;
    }

    const fragA = curCtx.$meta.fragments[a];
    if(!fragA) {
        return `No fragment '${a}'`;
    }
    const fragB = curCtx.$meta.fragments[b];
    if(!fragB) {
        return `No fragment '${b}'`;
    }

    fragA.code = fragA.code.concat( fragB.code );
    fragA.executed = (fragA.executed && fragB.executed);
    delete curCtx.$meta.fragments[b]; 
}

function addContext(name) {

    const ctx = {
        '$meta': {
            name: name,
            fragments: {},
            numFrags: 1,
            curFrag: null,
            history: {},
            log: ctxLog,
            save: ctxSave,
            load: ctxLoad,
            opts: {
                format: true,
                highlight: true,
                scrollSpeed: 10,
            },
            util: {
                lsFrag: ()=>Object.keys(curCtx.$meta.fragments),
                mergeFrags: ctxMergeFrags
            }
        },
        require,
        fs,
        setTimeout,
        clearTimeout,
        setInterval,
        vm,
        process,
        stdout,
        help,

    };
    ctx.$meta.curFrag = addFragment(ctx.$meta.fragments, createFragment( 'frag_0'));

    return contexts[name] = vm.createContext(ctx, {name: ctx.$meta.name});
}

let curCtx = addContext('new');


const edit = curCtx.$meta.curFrag.edit;

async function draw() {

    let n=0;
    let l=0;
    let newY = -1;
    let newX = -1;


    let outBuf='';

    for(const fk in curCtx.$meta.fragments ) {
        const frag = curCtx.$meta.fragments[fk];
        const space = (frag.edit.executed)?' ':'|';
        const source = (curCtx.$meta.opts.highlight)?highlight(frag.code.join('\n'), highlightOpts).split('\n'):frag.code;
        for(const line of source) {
            if( frag.edit.error ) {
                outBuf += (c.bgRed(space));
            } else if(frag.detached) {
                outBuf += (c.bgYellow.black(space));
            } else if( (n%2===0)) {
                outBuf += (c.bgBlue.white(space));
            } else {
                outBuf += (c.bgGreen.black(space));
            }
            outBuf +=(line+'\n');
            l++;
        }
        if( fk === curCtx.$meta.curFrag.name) {
            newY = l - curCtx.$meta.curFrag.code.length + curCtx.$meta.curFrag.edit.row - viewPort.firstLine;
        }
        for(const line of frag.out) {
            outBuf += (line+'\n');
            l++;
        }
        n++;
    }

    // TODO: these while loops are idiocracy, but I'm tired and can't math, fix
    while(newY-3 < 0 && viewPort.firstLine>0) {
        newY++;
        viewPort.firstLine--;
    }
    while(newY+3 > viewPort.height  ) {
        newY--;
        viewPort.firstLine++;
    }

    outBuf = outBuf.split('\n').splice(viewPort.firstLine, viewPort.height).join('\n');
	await stdout.cursorTo(0,0);
	await stdout.clearScreenDown();
    // here print outpuf
    await stdout.write(outBuf);
    await stdout.cursorTo(curCtx.$meta.curFrag.edit.col+1, newY);



}

const beautifyOpts = {
    indent_size: 4,
    space_in_empty_paren: true,
};


function exe(ctx) {

    const frag = ctx.$meta.curFrag;
    let code = frag.code.join('\n');

    if(ctx.$meta.opts.format) {
        code = beautify( code, beautifyOpts );
    }

    frag.code = code.split('\n');

    const row = frag.edit.row;
    const col = frag.edit.col;

    if(row > frag.code.length -1 ) {
        frag.edit.row = frag.code.length -1;
    }

    if(col > frag.code[ frag.edit.row ].length -1 ) {
        frag.edit.col = frag.code[ frag.edit.row ].length ;
    }

    logOut = frag.out;

    if(frag.detached) {
        delete curCtx.$meta.fragments[frag.name];
        curCtx.$meta.curFrag = null;
    }

    frag.edit.executed = true;
    try {
        const retVal = vm.runInContext( code, ctx );
        if(retVal !== undefined) {
            frag.out = ('=> '+retVal).split('\n').concat(logOut);
        }
        frag.edit.error = false;
        const his = curCtx.$meta.history;
        if(!his[frag.name]) {
            his[frag.name] = [];
        }
        const fhis = his[frag.name];
        frag.revision = fhis.length;
        fhis.push( JSON.parse( JSON.stringify(frag) ) );
    } catch (e) {
        frag.edit.error = true;
        logOut.push(e.toString() );
    }

    if(frag.detached) {
        curCtx.$meta.fragments[frag.name] = frag;
        curCtx.$meta.curFrag = frag;
    }
}

function resize() {
    viewPort.width = stdout.columns;
    viewPort.height = stdout.rows;
	draw();
}

function whitespace(str) {

    if(str === '') {
        return true;
    }


    if(str[str.length-1] === ' ') {
        return true;
    }
}

stdin.setRawMode(true);
stdin.setEncoding('utf8');

stdin.resume();

let autoCompleteCandidate = null;
let justSetCandidate=false;
let autoCompleteOffset=0;

if(process.argv[2]) {
    const initLoadFn = process.argv[2];
    ctxLoad(initLoadFn);
}
resize();
stdout.on('resize', resize);

let searchTerm = false;

stdin.on('data', function (key){
	const hex=Buffer.from(key).toString('hex');

    const code = curCtx.$meta.curFrag.code;
    const col = curCtx.$meta.curFrag.edit.col;
    const row = curCtx.$meta.curFrag.edit.row;
    const lin = curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row ];
    const linBeforeCur  = lin.slice(0,col);
    const linAfterCur = lin.slice(col);

    justSetCandidate=false;

	switch(hex) {
        case '06': // ctrl +f = find
            searchTerm = '';
            stdout.cursorTo(0);
            stdout.write( '>> FIND:                                 ');
            stdout.cursorTo(9);
        break;
        case '04': // ctrl + d clear line
            if( code[row].length) {
                code[row] = '';
                curCtx.$meta.curFrag.edit.col = 0;
            } else { 
                if(code.length>1) {
                    code.splice( row,1 );
                    if(row == code.length ) {
                        curCtx.$meta.curFrag.edit.row--;
                    }
                }
            }
            draw();
        break;
		case '03':
            stdout.cursorTo(0,0);
            stdout.clearScreenDown();
            stdout.cursorTo(0,0);
            process.exit();
        break;
        case '12':
            curCtx.$meta.curFrag.out=[];
            exe(curCtx);
            draw();
        break;
        case '1b5b363b337e': // alt + pg dn
            {
                const edit = curCtx.$meta.curFrag.edit;
                const code = curCtx.$meta.curFrag.code;
                edit.row += curCtx.$meta.opts.scrollSpeed;
                if(edit.row > code.length) {
                    edit.row = code.length -1;
                }
                if(edit.col >= code[edit.row].length) {
                    edit.col = code[edit.row].length-1;
                }
            }
            draw();
        break;
        case '1b5b353b337e': // alt + pg up
            {
                const edit = curCtx.$meta.curFrag.edit;
                const code = curCtx.$meta.curFrag.code;
                edit.row -= curCtx.$meta.opts.scrollSpeed;
                if(edit.row < 0) {
                    edit.row = 0;
                }
                if(edit.col >= code[edit.row].length) {
                    edit.col = code[edit.row].length-1;
                }
            }
            draw();
        break;


        case '0b': // ctrl + k remove current fragment
        {
            const frags = Object.keys(curCtx.$meta.fragments);
            if(frags.length > 1) {
                const idx = frags.indexOf(curCtx.$meta.curFrag.name);
                delete curCtx.$meta.fragments[curCtx.$meta.curFrag.name];
                if(idx === 0) {
                    curCtx.$meta.curFrag=curCtx.$meta.fragments[frags[1]];
                } else {
                    curCtx.$meta.curFrag=curCtx.$meta.fragments[frags[idx-1]];
                }
            } else {
                curCtx.$meta.curFrag.edit.col=0;;
                curCtx.$meta.curFrag.edit.row=0;
                curCtx.$meta.curFrag.code=[''];
                curCtx.$meta.curFrag.out=[];
                curCtx.$meta.curFrag.edit.executed=false;
           }
           draw();
        }
        break;

        case '0e': //ctrl + n == clear context
        {
            const newCtx = addContext( curCtx.$meta.name );
            newCtx.$meta = curCtx.$meta;
            for( const fragName in curCtx.$meta.fragments ) {
                curCtx.$meta.fragments[fragName].edit.executed=false;
                curCtx.$meta.fragments[fragName].out=[];
            }
            curCtx = newCtx;
            draw();

        }
        break;

        case 'c292':
            const lastFrag =curCtx.$meta.curFrag;
            for( const fragName in curCtx.$meta.fragments) {
                const frag = curCtx.$meta.fragments[fragName];
                curCtx.$meta.curFrag=frag;
                curCtx.$meta.curFrag.out=[];
                exe(curCtx);
            }
            draw();
            curCtx.$meta.curFrag=lastFrag;
        break;
        case '1b5b41': // up
            if( curCtx.$meta.curFrag.edit.row>0 ) {
                curCtx.$meta.curFrag.edit.row--;
                if( curCtx.$meta.curFrag.edit.col > curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row].length )
                {
                    curCtx.$meta.curFrag.edit.col = curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row].length;
                }
                draw();
            } else {

                const keys = Object.keys(curCtx.$meta.fragments);
                const idx = keys.indexOf(curCtx.$meta.curFrag.name);
                if(idx>0) {
                    curCtx.$meta.curFrag = curCtx.$meta.fragments[keys[idx-1]];
                    draw();
                }
            }
        break;
        case '1b5b327e': // ins
            curCtx.$meta.curFrag.detached = !curCtx.$meta.curFrag.detached;
            draw();
        break;
        case '1b5b42': // down
            if( curCtx.$meta.curFrag.edit.row+1 < curCtx.$meta.curFrag.code.length ) {
                curCtx.$meta.curFrag.edit.row++;
                if( curCtx.$meta.curFrag.edit.col > curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row].length )
                {
                    curCtx.$meta.curFrag.edit.col = curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row].length;
                }
                draw();
            } else if( curCtx.$meta.curFrag.code.join().length ) {

                // Is there another?
                const keys = Object.keys(curCtx.$meta.fragments);
                const idx = keys.indexOf(curCtx.$meta.curFrag.name);
                if(idx+1=== keys.length) {
                    //Create new
                    curCtx.$meta.curFrag = addFragment( curCtx.$meta.fragments, createFragment('frag_'+(curCtx.$meta.numFrags++) ) );
                } else {
                    curCtx.$meta.curFrag = curCtx.$meta.fragments[keys[idx+1]];
                }
                draw();

            }
        break;

        case '1b5b44': // left
            if( curCtx.$meta.curFrag.edit.col > 0) {
                curCtx.$meta.curFrag.edit.col--;
                draw();
            }
        break;

        case '1b5b43': // right
            if( curCtx.$meta.curFrag.edit.col < curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row].length ) {
                curCtx.$meta.curFrag.edit.col++;
                draw();
            }
        break;
        case '7f': // backspace
            if( curCtx.$meta.curFrag.edit.col > 0) {
                curCtx.$meta.curFrag.edit.col--;
                curCtx.$meta.curFrag.code[ curCtx.$meta.curFrag.edit.row ] = lin.slice( 0, col-1)+lin.slice(col);
                draw();
            } else if( curCtx.$meta.curFrag.code[curCtx.$meta.curFrag.edit.row].length == 0 && curCtx.$meta.curFrag.edit.row >0) {
                curCtx.$meta.curFrag.code.splice( curCtx.$meta.curFrag.edit.row, 1 );
                curCtx.$meta.curFrag.edit.row--;
                draw();
            }
            curCtx.$meta.curFrag.edit.executed=false;
        break;
        case '1b5b337e': //del
            if( code[row].length>0) {
                code[row] = lin.slice( 0, col)+lin.slice(col+1);
                if(col === code[row].length && col>0) {
                    curCtx.$meta.curFrag.edit.col--;
                }
                draw();
            }
        break;
        case '0d': // enter
            if(searchTerm) {
                {
                    let idx=0;
                    for(const l of curCtx.$meta.curFrag.code) {
                        if(l.indexOf(searchTerm) !== -1) {
                            curCtx.$meta.curFrag.edit.row = idx;
                            curCtx.$meta.curFrag.edit.col = l.indexOf(searchTerm);
                            break;
                        }
                        idx++;
                    }
                }
                searchTerm=false;
            } else if(autoCompleteCandidate) {
                curCtx.$meta.curFrag.code[ row ] = curCtx.$meta.curFrag.code[ row ].slice(0, -autoCompleteOffset) + autoCompleteCandidate;
                curCtx.$meta.curFrag.edit.col += autoCompleteCandidate.length - autoCompleteOffset;
                autoCompleteCandidate=null;
            } else {
                curCtx.$meta.curFrag.code.splice( row+1, 0, '');
                curCtx.$meta.curFrag.edit.col=0;
                curCtx.$meta.curFrag.edit.row=row+1;
                curCtx.$meta.curFrag.edit.executed=false;
            }
            draw();
        break;

        case '1b5b363b357e': // ctrl + pg down
        {
            const curFragName = curCtx.$meta.curFrag.name;
            const fragNames = Object.keys(curCtx.$meta.fragments);
            const curFragIdx= fragNames.indexOf(curFragName);
            if(curFragIdx+1 < fragNames.length) {
                curCtx.$meta.curFrag = curCtx.$meta.fragments[fragNames[curFragIdx+1]];
                draw();
            }
        }
        break;
        case '1b5b353b357e': // ctrl +  pg up
        {
            const curFragName = curCtx.$meta.curFrag.name;
            const fragNames = Object.keys(curCtx.$meta.fragments);
            const curFragIdx= fragNames.indexOf(curFragName);
            if(curFragIdx > 0) {
                curCtx.$meta.curFrag = curCtx.$meta.fragments[fragNames[curFragIdx-1]];
                draw();
            }
        }
        break;

        case '1b5b313b3342': // alt + down
        {
            const frag = curCtx.$meta.curFrag;
            const his = curCtx.$meta.history[frag.name];
            if(!his) break;
            if(frag.revision + 1 < his.length) {
                curCtx.$meta.fragments[frag.name] = curCtx.$meta.curFrag = JSON.parse(JSON.stringify(his[ frag.revision + 1]));
                draw();
            }
        }
        break;
        case '1b5b313b3341': // alt + up
        {
            const frag = curCtx.$meta.curFrag;
            const his = curCtx.$meta.history[frag.name];
            if(!his) break;
            if(frag.revision > 0) {
                curCtx.$meta.fragments[frag.name] = curCtx.$meta.curFrag = JSON.parse(JSON.stringify(his[ frag.revision - 1]));
                draw();
            }
        }
        break;

        case '1b5b367e': // pg dn
            curCtx.$meta.curFrag.edit.row = curCtx.$meta.curFrag.code.length-1;
            if(col > curCtx.$meta.curFrag.code[curCtx.$meta.curFrag.edit.row].length) {
                curCtx.$meta.curFrag.edit.col = curCtx.$meta.curFrag.code[curCtx.$meta.curFrag.edit.row].length-1;
            }
            draw();
        break;

        case '1b5b357e': // pg up
            curCtx.$meta.curFrag.edit.row = 0;
            if(col > curCtx.$meta.curFrag.code[0].length) {
                curCtx.$meta.curFrag.edit.col = curCtx.$meta.curFrag.code[0].length-1;
            }
            draw();
        break;

        case '09': // tab
            if( whitespace(linBeforeCur) ) {
                //Insert 4 spaces
                code[row] = lin.slice(0,col) + '    '+lin.slice(col);
                curCtx.$meta.curFrag.edit.col += 4;
                draw();
            } else {
                //Tab complete
                const candidates = [];
                const words = linBeforeCur.split(' ');
                const word = words[words.length-1];


                let obj = curCtx;
                const path = [];
                let exact=true;
                for( const item of word.split('.')) {
                    if( obj[item] !== undefined) {
                        path.push(item);
                        obj = obj[item];
                    } else {
                        exact=false;
                        Object.keys( obj ).forEach( key=>{
                            if( key.indexOf(item) === 0) {
                                candidates.push(key);
                            }
                        });

                        candidates.sort( (a,b)=>a.length > b.length);
                        if(candidates.length) {
                            autoCompleteCandidate=candidates[0];
                            autoCompleteOffset = item.length;
                            justSetCandidate=true;
                        }
                        stdout.write('\n<            \n'+candidates.map( (c,i) =>'     '+path.join('.')+((path.length)?'.':'')+c+'       \n').join('')+ '>              ');
                    }
                }
                if(exact) {
                    stdout.write('\n<exact match>');
                }
            }
        break;

        case '0c': // ctrl + l == clear fragouts
        {
            for(const fragName in curCtx.$meta.fragments) {
                const frag = curCtx.$meta.fragments[fragName];
                frag.out =[];
            }
            draw();
        }
        break;

        case '1b5b48': // home
            curCtx.$meta.curFrag.edit.col = 0;
            draw();
        break;
        case '1b5b46': // end
            curCtx.$meta.curFrag.edit.col = lin.length;
            draw();
        break;

        case '1b5b313b3543': //ctrl+right
        break;

        case '1b5b313b3544': // ctrl+left
        break;

        default: // Insert new char, or print debug code
            if( /[\x00-\x1F\x80-\x9F]/.test(key)) {
        	    stdout.write('\n<'+Buffer.from(key).toString('hex')+'>\n');
            } else {
                if(searchTerm !== false) {
                    searchTerm+= key;
                    stdout.write( c.red(key));
                    break;
                }
                curCtx.$meta.curFrag.code[curCtx.$meta.curFrag.edit.row] = lin.slice(0, col) + key + lin.slice(col);
                curCtx.$meta.curFrag.edit.col++;
                curCtx.$meta.curFrag.edit.executed=false;
                draw();
            }
	}

    if(!justSetCandidate) {
        justSetCandidate=false;
        autoCompleteCandidate=null;
    }
});
// EOF
