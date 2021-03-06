import {PythonResult} from "arepl-backend"
import * as vscode from "vscode"
import PythonPreview from "./pythonPreview"
import Reporter from "./telemetry"
import Utilities from "./utilities"

/**
 * logic wrapper around html preview doc
 */
export class PreviewContainer{
    public scheme: string
    public printResults: string[] = [];
    public errorDecorationType: vscode.TextEditorDecorationType
    
    private pythonPreview: PythonPreview
    private vars: {}

    constructor(private reporter: Reporter, private context: vscode.ExtensionContext, private settings:vscode.WorkspaceConfiguration, htmlUpdateFrequency=50){
        this.pythonPreview = new PythonPreview(context, htmlUpdateFrequency);
        this.scheme = PythonPreview.scheme
        this.errorDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath('media/red.jpg')
        })
    }

    public start(){
        return this.pythonPreview.start()
    }

    public handleResult(pythonResults: PythonResult){

        // TODO: Hook these onto a config, turn it off by default
        // console.log(`Exec time: ${pythonResults.execTime}`)
        // console.log(`Python time: ${pythonResults.totalPyTime}`)
        // console.log(`Total time: ${pythonResults.totalTime}`)

        try {            
            // exec time is the 'truest' time that user cares about
            this.pythonPreview.updateTime(pythonResults.execTime);

            if(!pythonResults.done){
                pythonResults.userVariables = this.updateVarsWithDumpOutput(pythonResults)
            }

            this.vars = {...this.vars, ...pythonResults.userVariables}

            // if no Vars & an error exists then it must be a syntax exception
            // in which case we skip updating because no need to clear out variables
            if(!Utilities.isEmpty(pythonResults.userVariables) || pythonResults.userError == ""){
                this.pythonPreview.updateVars(this.vars)
            }

            if(pythonResults.done){
                this.vars = {}
            }

            if(pythonResults.internalError){
                this.reporter.sendError(pythonResults.internalError)
                pythonResults.userError = pythonResults.internalError
            }

            if(this.printResults.length == 0) this.pythonPreview.clearPrint()

            this.updateError(pythonResults.userError, true)
            if(this.settings.get('inlineResults')){
                this.updateErrorGutterIcons(pythonResults.userError)
            }

            // clear print so empty for next program run
            if(pythonResults.done) this.printResults = [];
        } catch (error) {
            this.reporter.sendError(error.stack)
            vscode.window.showErrorMessage(error.stack)
        }

    }

    public handlePrint(pythonResults: string){
        this.printResults.push(pythonResults);
        this.pythonPreview.handlePrint(this.printResults.join('\n'))
    }

    /**
     * @param refresh if true updates page immediately.  otherwise error will show up whenever updateContent is called
     */
    public updateError(err: string, refresh=false){
        this.pythonPreview.updateError(err, refresh)
    }

    public displayProcessError(err: string){
        this.pythonPreview.displayProcessError(err)
    }

    /**
     * sets gutter icons in sidebar. Safe - catches and logs any exceptions
     */
    private updateErrorGutterIcons(error: string){
        try {
            const errLineNums = this.getLineNumsFromPythonTrace(error)
            
            let decorations = errLineNums.map((num)=>{
                const lineNum = num-1 // python trace uses 1-based indexing but vscode lines start at 0
                const range = new vscode.Range(lineNum, 0, lineNum, 0)
                return {range} as vscode.DecorationOptions
            })
            
            vscode.window.activeTextEditor.setDecorations(this.errorDecorationType, decorations)

        } catch (error) {
            console.error(error)
            this.reporter.sendError(error)
        }
    }

    /**
     * returns line numbers for each error in the stack trace
     * @param error a python stacktrace
     */
    private getLineNumsFromPythonTrace(error: string){
            /* this regex will get the line number of each error. A error might look like this:
            
            Traceback (most recent call last):
            line 4, in <module>
            line 2, in foo
            TypeError: unsupported operand type(s) for +: 'int' and 'str'
            
            The regex will not get line numbers in different files. Those have different format:
            File "filePath", line 394, in func
            */
           const lineNumRegex = /^ *line (\d+), in /gm
           let errLineNums: number[] = []
           let match: RegExpExecArray
           
           while(match = lineNumRegex.exec(error)){
               const matchCaptureGroup = match[1]
               errLineNums.push(parseInt(matchCaptureGroup))
           }

           return errLineNums
    }

    /**
     * user may dump var(s), which we format into readable output for user
     * @param pythonResults result with either "dump output" key or caller and lineno
     */
    private updateVarsWithDumpOutput(pythonResults: PythonResult){
        const lineKey = "line " + pythonResults.lineno
        if(pythonResults.userVariables["dump output"] != undefined){
            const dumpOutput = pythonResults.userVariables["dump output"]
            pythonResults.userVariables = {}
            pythonResults.userVariables[lineKey] = dumpOutput
        }
        else{
            const v = pythonResults.userVariables
            pythonResults.userVariables = {}
            pythonResults.userVariables[pythonResults.caller + " vars " + lineKey] = v
        }

        return pythonResults.userVariables
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this.pythonPreview.onDidChange
    }
}