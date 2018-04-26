const { spawn, exec } = require('child_process');

function pin(hash) {
    if (!isValidHash(hash)) return;
    const cmd = 'ipfs'
    const args = ['pin', 'add', '--progress', hash]
    const proc = spawn(cmd, args)

    proc.stderr.on('data', function(data) {
        console.log('err: '+data.toString())
    })
    proc.stdout.on('data', function(data) {
        console.log(data.toString())
    })
    proc.on('exit', function (exitCode) {
        console.log("IPFS: " + exitCode);
    });
}

function wget(hash) {
    if (!isValidHash(hash)) return;
    exec('curl https://ipfs.io/ipfs/'+hash+' > ~/videostmp/'+hash, (err, stdout, stderr) => {
    if (err) {
        console.log(err)
        // node couldn't execute the command
        return;
    } else {
        // the *entire* stdout and stderr (buffered)
        console.log(`${stdout}`);
        if (stderr && stderr.length>0)
        console.log(`e: ${stderr}`);
        exec('mv ~/videostmp/'+hash+' ~/videos/', (err, stdout, stderr) => {
        //console.log(`${stdout}`)
        })
    }

    // the *entire* stdout and stderr (buffered)
    console.log(`${stdout}`);
    if (stderr && stderr.length>0)
        console.log(`e: ${stderr}`);
    });
}

function isValidHash(hash) {
    if (!hash.match(/^[a-zA-Z0-9]+$/))
        return false;
    if (hash.length != 46)
        return false;
    if (!hash.startsWith('Qm'))
        return false;
    return true;
}

module.exports = {
    pin: pin,
    wget: wget
};
