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

function createFragment(map, name) {
    return map[name] = {
        name,
        revision: 0,
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

let logOut = null;

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
  pgup      - previous fragment
  pgdn      - next fragment
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

function ctxLoad(fn) {
    if(!fn) {
        return '$meta.load(\'filename\'); loads file into new fragment.';
    }

    try {
        const source = (`// File: ${fn}\n`+fs.readFileSync( fn, {encoding:'utf8'})).split('\n');

        const newFrag = createFragment(curCtx.$meta.fragments, 'file_'+fn);

        newFrag.code = source;

        return `Read ${source.length-1} lines from ${fn}.`;
        curCtx.$meta.curFrag.edit.executed=false;
    } catch(e) {
        return `Couldn't load file`;
    }


}

function addContext(name) {

    const ctx = {
        '$meta': {
            name: name,
            fragments: {},
            curFrag: null,
            log: ctxLog,
            save: ctxSave,
            load: ctxLoad,
            opts: {
                format: true,
                highlight: true,
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
    ctx.$meta.curFrag = createFragment( ctx.$meta.fragments, 'main');

    return contexts[name] = vm.createContext(ctx);;
}

let curCtx = addContext('new');


const edit = curCtx.$meta.curFrag.edit;

async function draw() {
	await stdout.cursorTo(0,0);
	await stdout.clearScreenDown();


    let n=0;
    let l=0;
    let newY = -1;
    let newX = -1;
    for(const fk in curCtx.$meta.fragments ) {
        const frag = curCtx.$meta.fragments[fk];
        const space = (frag.edit.executed)?' ':'|';
        const source = (curCtx.$meta.opts.highlight)?highlight(frag.code.join('\n'), highlightOpts).split('\n'):frag.code;
        for(const line of source) {
            if( frag.edit.error ) {
                stdout.write(c.bgRed(space));
            } else if( (n%2===0)) {
                stdout.write(c.bgBlue(space));
            } else {
                stdout.write(c.bgGreen(space));
            }
            stdout.write(line+'\n');
            l++;
        }
        if( fk === curCtx.$meta.curFrag.name) {
            newY = l - curCtx.$meta.curFrag.code.length + curCtx.$meta.curFrag.edit.row;
        }
        for(const line of frag.out) {
            stdout.write(line+'\n');
            l++;
        }
        n++;
    }

    await stdout.cursorTo(curCtx.$meta.curFrag.edit.col+1, newY);



}

const beautifyOpts = {
    indent_size: 2,
    space_in_empty_paren: true,
    };


function exe(ctx) {

    let code = ctx.$meta.curFrag.code.join('\n');

    if(ctx.$meta.opts.format) {
        code = beautify( code, beautifyOpts );
    }

    ctx.$meta.curFrag.code = code.split('\n');

    const row = ctx.$meta.curFrag.edit.row;
    const col = ctx.$meta.curFrag.edit.col;

    if(row > ctx.$meta.curFrag.code.length -1 ) {
        ctx.$meta.curFrag.edit.row = ctx.$meta.curFrag.code.length -1;
    }

    if(col > ctx.$meta.curFrag.code[ ctx.$meta.curFrag.edit.row ].length -1 ) {
        ctx.$meta.curFrag.edit.col = ctx.$meta.curFrag.code[ ctx.$meta.curFrag.edit.row ].length ;
    }

    logOut = ctx.$meta.curFrag.out;
    ctx.$meta.curFrag.edit.executed = true;
    try {
        const retVal = vm.runInContext( code, ctx );
        if(retVal !== undefined) {
            ctx.$meta.curFrag.out = ('=> '+retVal).split('\n').concat(logOut);
        }
        ctx.$meta.curFrag.edit.error = false;
    } catch (e) {
        ctx.$meta.curFrag.edit.error = true;
        logOut.push(e.toString() );
    }
}

function resize() {
	draw();
}
resize();

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

stdout.on('resize', resize);

stdin.resume();

let autoCompleteCandidate = null;
let justSetCandidate=false;
let autoCompleteOffset=0;

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
        case '04': // ctrl + d clear line
            code[row] = '';
            curCtx.$meta.curFrag.edit.col = 0;
            if(code.length>1) {
                code.splice( row,1 );
                if(row == code.length ) {
                    curCtx.$meta.curFrag.edit.row--;
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
                    curCtx.$meta.curFrag = createFragment(curCtx.$meta.fragments, 'frag_'+idx+1);
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
            if(autoCompleteCandidate) {
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
