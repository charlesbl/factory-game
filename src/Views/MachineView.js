import React from 'react';
import '../css/Machine.css'

class MachineView extends React.Component {
    render() {
        var canCraft = this.props.machine.craft.canCraft(this.props.machine.factory) || this.props.machine.isCrafting;
        var craftBtn = this.props.machine.manual ? <button onClick={() => this.props.machine.manualUpdate()} className="btn btn-warning btn-side" disabled={!canCraft}><i class="fas fa-hammer fa-xs"></i></button> : "";
        var pauseBtn = !this.props.machine.manual ? <button onClick={() => this.props.machine.togglePause()} className="btn btn-warning btn-side">{this.props.machine.pause ? <i class="fas fa-play fa-xs"></i> : <i class="fas fa-pause fa-xs"></i>}</button> : "";
        var destroyBtn = !this.props.machine.manual ? <button onClick={() => this.props.machine.destroy()} className="btn btn-danger btn-side"><i class="fas fa-trash fa-xs"></i></button> : "";
        return (
            <div className="machine">
                <progress className="progress" max={100} value={this.props.machine.getPercentage()}></progress>
                {craftBtn}
                {pauseBtn}
                {destroyBtn}
            </div>
        );
    }
}
export default MachineView;